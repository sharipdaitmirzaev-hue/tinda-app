#!/usr/bin/env tsx
/**
 * Bavaria Group non-alcoholic catalog importer for TINDA Market.
 *
 * Commands (via npm scripts):
 *   discover  — crawl official sources (no DB writes)
 *   dry-run   — build proposed catalog + reports (no DB writes)
 *   apply     — gated; requires --i-understand-and-have-backup (not used in stage 1)
 *
 * Does NOT touch production by default. Never uses --merge. Never edits existing products.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "fs";
import path from "path";
import { classify_alcohol } from "../src/lib/imports/bavaria/alcohol";
import { propose_other_category } from "../src/lib/imports/bavaria/classify";
import { to_csv } from "../src/lib/imports/bavaria/csv";
import {
  assert_no_alcohol_in_proposed,
  find_identity_collisions,
  find_possible_duplicates,
  find_sku_collisions,
} from "../src/lib/imports/bavaria/dedupe";
import { expand_discovered_products } from "../src/lib/imports/bavaria/expand";
import { RateLimitedClient } from "../src/lib/imports/bavaria/http";
import { download_images_for_proposed } from "../src/lib/imports/bavaria/images";
import {
  extract_category_links,
  extract_product_links,
  parse_product_page,
} from "../src/lib/imports/bavaria/parse";
import type {
  DiscoveredProduct,
  ExistingCatalogProduct,
  ExistingCategory,
} from "../src/lib/imports/bavaria/types";

const ROOT = process.cwd();
const ARTIFACTS_ROOT = path.join(ROOT, "artifacts", "bavaria-import");

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensure_dir(p: string) {
  mkdirSync(p, { recursive: true });
}

function flatten_categories(nodes: unknown[], acc: ExistingCategory[] = []): ExistingCategory[] {
  for (const n of nodes as Array<{
    id: string;
    name: string;
    slug: string;
    children?: unknown[];
  }>) {
    acc.push({ id: n.id, name: n.name, slug: n.slug });
    if (n.children?.length) flatten_categories(n.children, acc);
  }
  return acc;
}

async function load_tinda_categories(): Promise<ExistingCategory[]> {
  const url = "https://tindamarket.ru/api/v1/catalog/categories";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`categories HTTP ${res.status}`);
  const data = (await res.json()) as { items: unknown[] };
  return flatten_categories(data.items || []);
}

async function load_tinda_products(): Promise<ExistingCatalogProduct[]> {
  const local = path.join(
    ROOT,
    "tmp/catalog-normalize-reports/2026-07-30-final/products-snapshot.json",
  );
  if (existsSync(local)) {
    const raw = JSON.parse(readFileSync(local, "utf8")) as ExistingCatalogProduct[];
    if (Array.isArray(raw) && raw.length) return raw;
  }

  const items: ExistingCatalogProduct[] = [];
  let page = 1;
  for (;;) {
    const url = `https://tindamarket.ru/api/v1/catalog/products?page=${page}&page_size=100`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`products HTTP ${res.status}`);
    const data = (await res.json()) as {
      items: ExistingCatalogProduct[];
      total: number;
    };
    items.push(...(data.items || []));
    if (items.length >= data.total || !(data.items || []).length) break;
    page += 1;
  }
  return items;
}

async function cmd_discover(out_dir: string) {
  ensure_dir(out_dir);
  const cache_dir = path.join(out_dir, "http-cache");
  const client = new RateLimitedClient({ cache_dir, min_interval_ms: 700 });
  await client.confirm_age();

  const source_pages: Array<Record<string, unknown>> = [];
  const cat_seeds = [
    "/beer-categories",
    "/beer-category/bezalkogolnye-napitki-bavaria",
    "/beer-category/gornaa-rodnikovaa-voda-tbau",
    "/beer-category/mineralnaa-voda-kazbek-akva",
    "/beer-category/pivo-i-sidr",
    "/beer-category/stm-dla-partnerov",
    "/en/beer-categories",
    "/service/gornaa-rodnikovaa-voda-tbau",
    "/service/vitaminnye-napitki-rocket-ride",
  ];

  const product_map = new Map<string, string[]>();
  for (const seed of cat_seeds) {
    const url = `https://www.bavaria-group.ru${seed}`;
    const html = await client.fetch_text(url);
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
    const products = extract_product_links(html);
    const cats = extract_category_links(html);
    source_pages.push({
      url,
      title,
      product_links: products.length,
      category_links: cats.length,
    });
    for (const p of products) {
      const prev = product_map.get(p) || [];
      prev.push(seed);
      product_map.set(p, prev);
    }
    for (const c of cats) {
      if (!cat_seeds.includes(c)) cat_seeds.push(c);
    }
  }

  // Official TBAU brand site (linked from manufacturer)
  for (const p of [
    "https://tbau.ru/",
    "https://tbau.ru/catalog/pet/",
    "https://tbau.ru/catalog/detskaya/",
    "https://tbau.ru/catalog/tbau-premium-voda/",
  ]) {
    try {
      const html = await client.fetch_text(p);
      source_pages.push({
        url: p,
        title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim(),
        bytes: html.length,
        role: "official_brand_site",
      });
    } catch (err) {
      source_pages.push({
        url: p,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const discovered: DiscoveredProduct[] = [];
  for (const [product_path, cats] of [...product_map.entries()].sort()) {
    const url = `https://www.bavaria-group.ru${product_path}`;
    const html = await client.fetch_text(url);
    discovered.push(
      parse_product_page(html, {
        path: product_path,
        url,
        source_categories: cats,
      }),
    );
    source_pages.push({
      url,
      title: discovered[discovered.length - 1].official_name,
      variants: discovered[discovered.length - 1].variants.length,
    });
  }

  const payload = {
    discovered_at: new Date().toISOString(),
    source: "https://www.bavaria-group.ru",
    product_count: discovered.length,
    products: discovered,
    source_pages,
  };
  writeFileSync(
    path.join(out_dir, "discovered.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(out_dir, "discovered-products.csv"),
    to_csv(
      discovered.map((p) => ({
        slug: p.slug,
        official_name: p.official_name,
        url: p.url,
        source_categories: p.source_categories.join("|"),
        variant_count: p.variants.length,
        has_image: p.variants.some((v) => !!v.image),
      })),
      [
        "slug",
        "official_name",
        "url",
        "source_categories",
        "variant_count",
        "has_image",
      ],
    ),
    "utf8",
  );
  writeFileSync(
    path.join(out_dir, "source-pages.csv"),
    to_csv(source_pages, ["url", "title", "product_links", "category_links", "variants", "bytes", "role", "error"]),
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        out_dir,
        products: discovered.length,
        source_pages: source_pages.length,
      },
      null,
      2,
    ),
  );
}

async function cmd_dry_run(out_dir: string, discover_dir?: string) {
  ensure_dir(out_dir);
  const src =
    discover_dir ||
    (existsSync(ARTIFACTS_ROOT)
      ? readdirSync(ARTIFACTS_ROOT)
          .filter((d) =>
            existsSync(path.join(ARTIFACTS_ROOT, d, "discovered.json")),
          )
          .sort()
          .pop()
      : undefined);

  let discovered_path = src
    ? path.join(ARTIFACTS_ROOT, src, "discovered.json")
    : "";
  // allow absolute/relative discover dir
  if (discover_dir && existsSync(path.join(discover_dir, "discovered.json"))) {
    discovered_path = path.join(discover_dir, "discovered.json");
  }
  if (!discovered_path || !existsSync(discovered_path)) {
    // fallback to /tmp research dump
    const fallback = "/tmp/bavaria-raw/discovered.json";
    if (!existsSync(fallback)) {
      throw new Error("No discovered.json — run import:bavaria:discover first");
    }
    discovered_path = fallback;
  }

  const raw = JSON.parse(readFileSync(discovered_path, "utf8")) as {
    products?: Array<DiscoveredProduct & { categories?: string[] }>;
    source_pages?: unknown[];
  };
  // support research dump shape (`categories`) and importer shape (`source_categories`)
  const products: DiscoveredProduct[] = (raw.products || []).map((p) => ({
    ...p,
    source_categories: p.source_categories?.length
      ? p.source_categories
      : p.categories || [],
    variants: (p.variants || []).map((v) => ({
      variant_title: v.variant_title || "",
      text: v.text || "",
      text_html: v.text_html || "",
      image: v.image || null,
    })),
  }));

  if (discovered_path !== path.join(out_dir, "discovered.json")) {
    copyFileSync(discovered_path, path.join(out_dir, "discovered.json"));
  }

  const categories = await load_tinda_categories();
  const existing_products = await load_tinda_products();
  const other = propose_other_category(categories);

  const expanded = expand_discovered_products(products, categories);
  const deduped = find_possible_duplicates(expanded.proposed, existing_products);

  // Images only for proposed (not alcoholic)
  const images_dir = path.join(out_dir, "images");
  const with_images = await download_images_for_proposed(
    deduped.proposed.filter((p) => p.import_status === "proposed"),
    images_dir,
  );

  // merge image paths back
  const by_sku = new Map(with_images.proposed.map((p) => [p.proposed_sku, p]));
  const proposed_final = deduped.proposed.map((p) => {
    const imaged = by_sku.get(p.proposed_sku);
    return imaged || p;
  });

  const proposed_importable = proposed_final.filter((p) => p.import_status === "proposed");
  const proposed_reviewish = proposed_final.filter((p) => p.import_status === "manual_review");

  writeFileSync(
    path.join(out_dir, "discovered-products.csv"),
    to_csv(
      products.map((p) => ({
        slug: p.slug,
        official_name: p.official_name,
        url: p.url,
        source_categories: p.source_categories.join("|"),
        variant_count: p.variants.length,
      })),
      ["slug", "official_name", "url", "source_categories", "variant_count"],
    ),
  );

  writeFileSync(
    path.join(out_dir, "proposed-products.csv"),
    to_csv(
      proposed_importable.map((p) => ({
        proposed_sku: p.proposed_sku,
        official_name: p.official_name,
        proposed_name: p.proposed_name,
        brand: p.brand,
        manufacturer: p.manufacturer,
        category: p.category,
        category_reason: p.category_reason,
        volume: p.volume,
        package: p.package,
        taste: p.taste,
        carbonation: p.carbonation,
        sugar: p.sugar,
        alcohol_percent: p.alcohol_percent,
        source_url: p.source_url,
        image_url: p.image_url,
        local_image_path: p.local_image_path,
        duplicate_status: p.duplicate_status,
        confidence: p.confidence,
        notes: p.notes,
      })),
      [
        "proposed_sku",
        "official_name",
        "proposed_name",
        "brand",
        "manufacturer",
        "category",
        "category_reason",
        "volume",
        "package",
        "taste",
        "carbonation",
        "sugar",
        "alcohol_percent",
        "source_url",
        "image_url",
        "local_image_path",
        "duplicate_status",
        "confidence",
        "notes",
      ],
    ),
  );

  writeFileSync(
    path.join(out_dir, "category-mapping.csv"),
    to_csv(
      expanded.category_rows.map((r) => ({
        product: r.product,
        official_type: r.official_type,
        proposed_category: r.category,
        reason: r.reason,
        confidence: r.confidence,
        is_other: r.is_other,
      })),
      [
        "product",
        "official_type",
        "proposed_category",
        "reason",
        "confidence",
        "is_other",
      ],
    ),
  );

  writeFileSync(
    path.join(out_dir, "possible-duplicates.csv"),
    to_csv(
      deduped.duplicates as unknown as Record<string, unknown>[],
      [
        "proposed_sku",
        "proposed_name",
        "existing_sku",
        "existing_name",
        "confidence",
        "reason",
      ],
    ),
  );

  writeFileSync(
    path.join(out_dir, "manual-review.csv"),
    to_csv(
      [
        ...expanded.manual_review,
        ...proposed_reviewish.map((p) => ({
          official_name: p.proposed_name,
          brand: p.brand,
          source_url: p.source_url,
          reason: p.notes || "Помечено manual_review",
          evidence: p.proposed_sku,
          suggested_action: "Проверить вкус/фасовку перед apply",
        })),
      ] as unknown as Record<string, unknown>[],
      [
        "official_name",
        "brand",
        "source_url",
        "reason",
        "evidence",
        "suggested_action",
      ],
    ),
  );

  writeFileSync(
    path.join(out_dir, "skipped-alcoholic.csv"),
    to_csv(
      expanded.skipped_alcoholic as unknown as Record<string, unknown>[],
      ["name", "brand", "alcohol_percent", "url", "reason"],
    ),
  );

  writeFileSync(
    path.join(out_dir, "image-report.csv"),
    to_csv(
      with_images.report as unknown as Record<string, unknown>[],
      [
        "proposed_sku",
        "source_image_url",
        "local_image_path",
        "sha256",
        "bytes",
        "status",
        "notes",
      ],
    ),
  );

  if (existsSync(path.dirname(discovered_path))) {
    const sp = path.join(path.dirname(discovered_path), "source-pages.csv");
    if (existsSync(sp)) copyFileSync(sp, path.join(out_dir, "source-pages.csv"));
  }
  if (!existsSync(path.join(out_dir, "source-pages.csv"))) {
    writeFileSync(
      path.join(out_dir, "source-pages.csv"),
      to_csv(
        (raw.source_pages as Record<string, unknown>[]) || [],
        ["url", "title", "product_links", "variants", "role", "error"],
      ),
    );
  }

  const by_cat: Record<string, number> = {};
  for (const p of proposed_importable) {
    by_cat[p.category] = (by_cat[p.category] || 0) + 1;
  }

  const na_beer = proposed_importable.filter((p) => p.category === "Безалкогольное пиво");
  const others = proposed_importable.filter((p) => p.category === other.name || p.category === "Другие");
  const sku_collisions = find_sku_collisions(proposed_importable);
  const id_collisions = find_identity_collisions(proposed_importable);
  const alcohol_leaks = assert_no_alcohol_in_proposed(proposed_importable);

  const image_ok = with_images.report.filter((r) =>
    r.status === "downloaded" || r.status === "reused",
  ).length;
  const image_missing = with_images.report.filter((r) => r.status === "missing" || r.status === "error").length;

  const manifest = {
    stage: "dry-run",
    created_at: new Date().toISOString(),
    manufacturer: "ГК ПД «Бавария»",
    source_primary: "https://www.bavaria-group.ru",
    source_brand_sites: ["https://tbau.ru/"],
    discovered_products: products.length,
    proposed_count: proposed_importable.length,
    manual_review_count: expanded.manual_review.length + proposed_reviewish.length,
    skipped_alcoholic_count: expanded.skipped_alcoholic.length,
    non_alcoholic_beer_count: na_beer.length,
    category_distribution: by_cat,
    other_category: other,
    categories_to_create: [
      other.create_proposed
        ? {
            name: "Другие",
            slug: other.slug,
            description:
              "Другие напитки и товары, для которых пока не определена отдельная категория.",
          }
        : null,
      !categories.some((c) => c.slug === "bezalkogolnoe-pivo")
        ? {
            name: "Безалкогольное пиво",
            slug: "bezalkogolnoe-pivo",
            description: "Безалкогольное пиво (≤0,5% об.), подтверждённое официальным источником.",
          }
        : null,
    ].filter(Boolean),
    duplicates: deduped.duplicates.length,
    images: {
      downloaded_or_reused: image_ok,
      missing_or_error: image_missing,
    },
    checks: {
      alcohol_in_proposed: alcohol_leaks,
      sku_collisions,
      identity_collisions: id_collisions,
      production_db_modified: false,
      catalog_normalize_run: false,
      merge_used: false,
      existing_products_edited: false,
    },
    apply: {
      sales_status: "showcase",
      is_active: true,
      price_amount: null,
      availability: "in_stock",
      note: "Цена не устанавливается; заказ недоступен без orderable+price",
    },
    proposed_skus: proposed_importable.map((p) => p.proposed_sku),
  };

  writeFileSync(path.join(out_dir, "import-manifest.json"), JSON.stringify(manifest, null, 2));

  const report_md = `# FINAL-REPORT — импорт безалкогольной продукции ГК «Бавария»

Дата: ${manifest.created_at}
Этап: **dry-run only** (production/БД не изменялись)

## 1. Найдено безалкогольных товарных позиций (proposed)
**${proposed_importable.length}**

## 2. Безалкогольное пиво
**${na_beer.length}**
${na_beer.map((p) => `- ${p.proposed_sku}: ${p.proposed_name}`).join("\n") || "_нет_"}

## 3. Исключено алкогольных позиций
**${expanded.skipped_alcoholic.length}**
(см. skipped-alcoholic.csv)

## 4. Распределение по категориям
${Object.entries(by_cat)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

## 5. Категория «Другие»
Предложение: **${other.name}** / \`${other.slug}\` (exists=${other.exists}, create=${other.create_proposed})

Позиции:
${others.map((p) => `- ${p.proposed_name} (${p.proposed_sku}) — ${p.category_reason}`).join("\n") || "_нет_"}

## 6. Вероятные дубли
**${deduped.duplicates.length}** (см. possible-duplicates.csv)

## 7. Ручная проверка
**${expanded.manual_review.length + proposed_reviewish.length}** (см. manual-review.csv)

## 8. Изображения
- скачано/переиспользовано: ${image_ok}
- без изображения/ошибка: ${image_missing}
- каталог: \`${images_dir}\`

## 9. Файлы
- discovered-products.csv
- proposed-products.csv
- category-mapping.csv
- possible-duplicates.csv
- manual-review.csv
- skipped-alcoholic.csv
- image-report.csv
- source-pages.csv
- import-manifest.json
- FINAL-REPORT.md

## 10. Проверки
- алкоголь в proposed: ${alcohol_leaks.length ? alcohol_leaks.join(", ") : "нет"}
- коллизии SKU: ${sku_collisions.length ? sku_collisions.join(", ") : "нет"}
- коллизии brand+taste+volume+package: ${id_collisions.length ? id_collisions.join(", ") : "нет"}
- production/БД изменены: **нет**
- catalog-normalize: **не запускался**
- --merge: **не использовался**

## 11. Следующий шаг
Только после явного разрешения:
1. backup БД
2. \`npm run import:bavaria:apply -- --i-understand-and-have-backup\`
`;

  writeFileSync(path.join(out_dir, "FINAL-REPORT.md"), report_md);
  console.log(JSON.stringify({ out_dir, ...manifest.checks, proposed_count: proposed_importable.length, by_cat }, null, 2));
}

function arg_value(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function validate_backup(backup_path: string): { ok: true; size: number } | { ok: false; error: string } {
  if (!existsSync(backup_path)) {
    return { ok: false, error: `backup file not found: ${backup_path}` };
  }
  const st = readFileSync(backup_path);
  if (!st.length) {
    return { ok: false, error: `backup file is empty: ${backup_path}` };
  }
  // Readable check: first bytes look like pg_dump custom/sql/tar or plain SQL
  const head = st.subarray(0, Math.min(64, st.length)).toString("utf8");
  const looks_sql =
    head.includes("PostgreSQL") ||
    head.includes("pg_dump") ||
    head.includes("CREATE TABLE") ||
    head.includes("--") ||
    st[0] === 0x50; // 'P' of PGDMP custom format sometimes
  if (!looks_sql && st.length < 1024) {
    return {
      ok: false,
      error: `backup file looks too small/unreadable as DB dump (${st.length} bytes)`,
    };
  }
  return { ok: true, size: st.length };
}

type FinalManifest = {
  stage?: string;
  pdf_file_available?: boolean;
  pdf_sha256?: string;
  approved_skus?: string[];
  categories_to_create?: Array<{ name: string; slug: string; description?: string }>;
  apply?: {
    sales_status?: string;
    is_active?: boolean;
    price_amount?: number | null;
    availability?: string;
  };
};

type ApprovedRow = {
  proposed_sku: string;
  proposed_name: string;
  brand?: string;
  category?: string;
  volume?: string;
  package?: string;
  taste?: string;
  source_url?: string;
  image_url?: string;
  local_image_path?: string;
  manufacturer?: string;
  description?: string;
};

function parse_csv_rows(text: string): ApprovedRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: ApprovedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // minimal CSV parse with quotes
    const cols: string[] = [];
    let cur = "";
    let inq = false;
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        if (inq && line[c + 1] === '"') {
          cur += '"';
          c++;
        } else inq = !inq;
        continue;
      }
      if (ch === "," && !inq) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? "").trim();
    });
    if (!obj.proposed_sku) continue;
    rows.push(obj as unknown as ApprovedRow);
  }
  return rows;
}

async function cmd_apply() {
  const confirmed = process.argv.includes("--i-understand-and-have-backup");
  const backup_path = arg_value("--backup-path");
  const manifest_path = arg_value("--manifest");

  if (!confirmed) {
    console.error(
      "APPLY BLOCKED: pass --i-understand-and-have-backup after creating a DB backup.",
    );
    process.exitCode = 2;
    return;
  }
  if (!backup_path) {
    console.error("APPLY BLOCKED: pass --backup-path /path/to/dump");
    process.exitCode = 2;
    return;
  }
  if (!manifest_path) {
    console.error(
      "APPLY BLOCKED: pass --manifest <path to approved-import-manifest-final.json>",
    );
    process.exitCode = 2;
    return;
  }
  if (process.argv.includes("--merge")) {
    console.error("APPLY BLOCKED: --merge is not allowed for Bavaria import");
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("APPLY BLOCKED: DATABASE_URL is not set in this environment");
    process.exitCode = 2;
    return;
  }

  const backup = validate_backup(backup_path);
  if (!backup.ok) {
    console.error(`APPLY BLOCKED: ${backup.error}`);
    process.exitCode = 2;
    return;
  }

  if (!existsSync(manifest_path)) {
    console.error(`APPLY BLOCKED: manifest not found: ${manifest_path}`);
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as FinalManifest;
  if (manifest.pdf_file_available !== true || !manifest.pdf_sha256) {
    console.error(
      "APPLY BLOCKED: manifest must include pdf_file_available=true and pdf_sha256 from real booklet ingest.",
    );
    process.exitCode = 2;
    return;
  }
  if (!manifest.approved_skus?.length) {
    console.error("APPLY BLOCKED: manifest has no approved_skus");
    process.exitCode = 2;
    return;
  }

  const manifest_dir = path.dirname(manifest_path);
  const approved_csv_candidates = [
    path.join(manifest_dir, "approved-products-final.csv"),
    path.join(manifest_dir, "approved-products.csv"),
  ];
  const approved_csv = approved_csv_candidates.find((p) => existsSync(p));
  if (!approved_csv) {
    console.error(
      "APPLY BLOCKED: approved-products-final.csv (or approved-products.csv) missing next to manifest",
    );
    process.exitCode = 2;
    return;
  }

  const approved_rows = parse_csv_rows(readFileSync(approved_csv, "utf8")).filter((r) =>
    manifest.approved_skus!.includes(r.proposed_sku),
  );
  if (!approved_rows.length) {
    console.error("APPLY BLOCKED: no approved rows matched manifest SKUs");
    process.exitCode = 2;
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const apply_out = path.join(ARTIFACTS_ROOT, `${stamp()}-apply`);
  ensure_dir(apply_out);

  const result = {
    started_at: new Date().toISOString(),
    backup_path,
    backup_size: backup.size,
    manifest_path,
    pdf_sha256: manifest.pdf_sha256,
    created: [] as string[],
    skipped_existing: [] as string[],
    errors: [] as Array<{ sku: string; error: string }>,
    categories_created: [] as string[],
    existing_products_edited: false,
  };

  try {
    // Ensure categories
    const wanted = new Map<string, { name: string; slug: string }>();
    for (const c of manifest.categories_to_create || []) {
      wanted.set(c.slug, { name: c.name, slug: c.slug });
    }
    // Always ensure NA beer + map from rows
    const slug_by_category: Record<string, string> = {
      "Газированные напитки": "gazirovannye-napitki",
      "Питьевая вода": "pitevaya-voda",
      "Минеральная вода": "mineralnaya-voda",
      "Холодный чай": "holodnyy-chay",
      Тоники: "toniki",
      Квас: "kvas",
      "Безалкогольное пиво": "bezalkogolnoe-pivo",
      "Энергетические напитки": "energeticheskie-napitki",
      Другие: "other",
    };
    for (const row of approved_rows) {
      const cat = row.category || "Другие";
      const slug = slug_by_category[cat] || "other";
      if (!wanted.has(slug)) wanted.set(slug, { name: cat, slug });
    }

    const category_id_by_slug = new Map<string, string>();
    for (const c of wanted.values()) {
      const existing = await prisma.categories.findUnique({ where: { slug: c.slug } });
      if (existing) {
        category_id_by_slug.set(c.slug, existing.id);
        continue;
      }
      // Only create «Другие» and «Безалкогольное пиво» if missing; others must exist or error
      if (c.slug === "other" || c.slug === "bezalkogolnoe-pivo") {
        const created = await prisma.categories.create({
          data: {
            name: c.name,
            slug: c.slug,
            sort_order: 900,
            is_active: true,
          },
        });
        category_id_by_slug.set(c.slug, created.id);
        result.categories_created.push(c.slug);
      } else {
        // try resolve by name
        const by_name = await prisma.categories.findFirst({ where: { name: c.name } });
        if (by_name) {
          category_id_by_slug.set(c.slug, by_name.id);
        } else {
          throw new Error(
            `Category missing in DB and not auto-creatable: ${c.name} (${c.slug})`,
          );
        }
      }
    }

    const sales_status = manifest.apply?.sales_status || "showcase";
    const availability = manifest.apply?.availability || "in_stock";
    const is_active = manifest.apply?.is_active ?? true;

    for (const row of approved_rows) {
      const sku = row.proposed_sku.trim();
      try {
        const existing = await prisma.products.findUnique({ where: { sku } });
        if (existing) {
          result.skipped_existing.push(sku);
          continue;
        }
        const cat_name = row.category || "Другие";
        const slug = slug_by_category[cat_name] || "other";
        const category_id = category_id_by_slug.get(slug);
        if (!category_id) {
          throw new Error(`No category id for ${cat_name}`);
        }
        const description = [
          row.manufacturer ? `Производитель: ${row.manufacturer}` : "Производитель: ГК ПД «Бавария»",
          row.taste ? `Вкус: ${row.taste}` : null,
          row.source_url ? `Источник: ${row.source_url}` : null,
          "Импорт: Bavaria non-alcoholic catalog (showcase, без цены)",
        ]
          .filter(Boolean)
          .join("\n");

        await prisma.products.create({
          data: {
            sku,
            name: row.proposed_name.trim(),
            brand: row.brand?.trim() || null,
            category_id,
            volume_text: row.volume?.trim() || null,
            package_type: row.package?.trim() || null,
            units_per_package: 1,
            sale_unit: "шт",
            min_order_qty: 1,
            allow_piece_sale: false,
            description,
            availability,
            sales_status,
            is_active,
            price_amount: null,
            price_currency: "RUB",
            image_url: row.image_url?.trim() || null,
            is_promo: false,
            is_new: true,
            is_hit: false,
          },
        });
        result.created.push(sku);
      } catch (err) {
        result.errors.push({
          sku,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  result.started_at = result.started_at; // keep
  const finished = {
    ...result,
    finished_at: new Date().toISOString(),
    created_count: result.created.length,
    skipped_count: result.skipped_existing.length,
    error_count: result.errors.length,
  };
  writeFileSync(path.join(apply_out, "apply-result.json"), JSON.stringify(finished, null, 2));
  writeFileSync(
    path.join(apply_out, "APPLY-REPORT.md"),
    `# Bavaria apply report

- backup: \`${backup_path}\` (${backup.size} bytes)
- manifest: \`${manifest_path}\`
- pdf_sha256: \`${manifest.pdf_sha256}\`
- created: **${finished.created_count}**
- skipped existing: **${finished.skipped_count}**
- errors: **${finished.error_count}**
- categories created: ${finished.categories_created.join(", ") || "—"}
- existing products edited: **false**
`,
  );
  console.log(JSON.stringify(finished, null, 2));
  if (finished.error_count) process.exitCode = 4;
}

async function main() {
  const cmd = process.argv[2] || "dry-run";
  const out = path.join(ARTIFACTS_ROOT, stamp());
  if (cmd === "discover") {
    await cmd_discover(out);
    return;
  }
  if (cmd === "dry-run") {
    const discover_dir_flag = process.argv.indexOf("--from");
    const from =
      discover_dir_flag >= 0 ? process.argv[discover_dir_flag + 1] : undefined;
    await cmd_dry_run(out, from);
    return;
  }
  if (cmd === "apply") {
    await cmd_apply();
    return;
  }
  // self-check helper used by tests
  if (cmd === "classify-alcohol-demo") {
    console.log(classify_alcohol(process.argv[3] || "", { is_beer_or_cider_context: true }));
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
