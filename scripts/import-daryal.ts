#!/usr/bin/env tsx
/**
 * Daryal (ВПБЗ «Дарьял») non-alcoholic catalog importer for TINDA Market.
 *
 * Commands:
 *   discover  — fetch official site pages, extract variants (no DB writes)
 *   dry-run   — build proposed SKUs + reports (no DB writes)
 *   apply     — gated create-only; requires --i-understand-and-have-backup + backup + manifest
 *
 * Scope: non-alcoholic only. Alcoholic beer (/beer/) is inventoried as excluded.
 * Stage 2 review/images: `npm run import:daryal:stage2` (Python).
 * Never edits existing products. Never creates categories. Never uses --merge.
 */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import path from "path";
import { classify_variant } from "../src/lib/imports/daryal/classify";
import { to_csv } from "../src/lib/imports/daryal/csv";
import { build_daryal_name } from "../src/lib/imports/daryal/names";
import {
  parse_beer_exclusion,
  parse_sparkling_page,
  parse_still_juice_page,
  parse_water_page,
} from "../src/lib/imports/daryal/parse";
import { build_daryal_sku } from "../src/lib/imports/daryal/sku";
import {
  DARYAL_DISCOVER_PAGES,
  DARYAL_EXCLUDED_PAGES,
  DARYAL_OFFICIAL_SOURCES,
} from "../src/lib/imports/daryal/sources";
import type {
  DiscoveredPage,
  DiscoveredVariant,
  ExistingCatalogProduct,
  ExistingCategory,
  ManualReviewItem,
  ProposedProduct,
  SkippedAlcoholicItem,
} from "../src/lib/imports/daryal/types";
import { upload_product_image } from "../src/lib/storage/product-images";

const ROOT = process.cwd();
const ARTIFACTS_ROOT = path.join(ROOT, "artifacts", "daryal-import");
const EXPECTED_APPROVED = 22;
const EXPECTED_SODA = 16;
const EXPECTED_WATER = 6;
const CATEGORY_SLUG_BY_NAME: Record<string, string> = {
  "Газированные напитки": "gazirovannye-napitki",
  "Минеральная вода": "voda-mineralnaya",
};
const FORBIDDEN_NAME_NEEDLES = [
  "фрутимикс",
  "frutimix",
  "грейпфрут",
  "фиеста",
  "живое пиво",
  "/beer/",
];

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

async function fetch_json<T>(url: string, attempts = 3): Promise<T> {
  let last_err: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      last_err = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last_err;
}

async function load_tinda_categories(): Promise<ExistingCategory[]> {
  const data = await fetch_json<{ items: unknown[] }>(
    "https://tindamarket.ru/api/v1/catalog/categories",
  );
  return flatten_categories(data.items || []);
}

async function load_tinda_products(): Promise<{
  items: ExistingCatalogProduct[];
  warning: string | null;
}> {
  try {
    const items: ExistingCatalogProduct[] = [];
    let page = 1;
    for (;;) {
      const data = await fetch_json<{
        items: ExistingCatalogProduct[];
        total: number;
      }>(
        `https://tindamarket.ru/api/v1/catalog/products?page=${page}&page_size=100`,
      );
      items.push(...(data.items || []));
      if (items.length >= data.total || !(data.items || []).length) break;
      page += 1;
      if (page > 50) break;
    }
    return { items, warning: null };
  } catch (err) {
    return {
      items: [],
      warning: `existing catalog fetch failed: ${String(err)}; duplicate check skipped`,
    };
  }
}

async function fetch_html(url: string): Promise<{ status: number; html: string; final_url: string }> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "TINDA-Daryal-Import/1.0 (+https://tindamarket.ru)",
    },
    redirect: "follow",
  });
  const html = await res.text();
  return { status: res.status, html, final_url: res.url };
}

function link_latest(dir: string, latest_name: string) {
  const latest = path.join(ARTIFACTS_ROOT, latest_name);
  try {
    if (existsSync(latest)) unlinkSync(latest);
  } catch {
    /* ignore */
  }
  try {
    symlinkSync(path.basename(dir), latest);
  } catch {
    // fallback copy marker
    writeFileSync(latest + ".txt", dir);
  }
}

function variant_key(v: DiscoveredVariant): string {
  return [
    v.line,
    v.brand,
    v.product_name,
    v.taste || "",
    v.carbonation || "",
    v.volume_ml ?? "NA",
    v.package || "NA",
  ]
    .join("|")
    .toLowerCase();
}

async function cmd_discover(args: string[]) {
  const out_dir = path.join(ARTIFACTS_ROOT, `${stamp()}-discover`);
  ensure_dir(out_dir);
  ensure_dir(path.join(out_dir, "raw-html"));

  const pages: DiscoveredPage[] = [];
  const all_variants: DiscoveredVariant[] = [];
  const manual_gaps: Array<{ page: string; reason: string; evidence: string }> = [];

  for (const page of DARYAL_DISCOVER_PAGES) {
    const { status, html, final_url } = await fetch_html(page.url);
    writeFileSync(path.join(out_dir, "raw-html", `${page.id}.html`), html, "utf8");

    let parsed: {
      title: string;
      variants: DiscoveredVariant[];
      manual_gaps: Array<{ reason: string; evidence: string }>;
    };

    if (page.id === "sparkling") parsed = parse_sparkling_page(html, page.url);
    else if (page.id === "water") parsed = parse_water_page(html, page.url);
    else parsed = parse_still_juice_page(html, page.url);

    const discovered: DiscoveredPage = {
      id: page.id,
      url: final_url,
      path: page.path,
      http_status: status,
      title: parsed.title,
      fetched_at: new Date().toISOString(),
      variants: parsed.variants,
      manual_gaps: parsed.manual_gaps,
    };
    pages.push(discovered);
    all_variants.push(...parsed.variants);
    for (const g of parsed.manual_gaps) {
      manual_gaps.push({ page: page.id, ...g });
    }
  }

  let skipped_alcohol: SkippedAlcoholicItem[] = [];
  for (const page of DARYAL_EXCLUDED_PAGES) {
    const { html } = await fetch_html(page.url);
    writeFileSync(path.join(out_dir, "raw-html", `${page.id}.html`), html, "utf8");
    skipped_alcohol = parse_beer_exclusion(html, page.url);
  }

  // dedupe variants
  const seen = new Set<string>();
  const unique_variants: DiscoveredVariant[] = [];
  for (const v of all_variants) {
    const k = variant_key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    unique_variants.push(v);
  }

  const payload = {
    manufacturer: "Дарьял",
    manufacturer_legal: "ООО ВПБЗ «Дарьял»",
    scope: "non_alcoholic_only",
    discovered_at: new Date().toISOString(),
    sources: DARYAL_OFFICIAL_SOURCES,
    pages,
    variants: unique_variants,
    variant_count: unique_variants.length,
    complete_variants: unique_variants.filter((v) => v.volume_ml && v.package).length,
    incomplete_variants: unique_variants.filter((v) => !v.volume_ml || !v.package).length,
    skipped_alcohol,
    manual_gaps,
    notes: [
      "Сайт Bitrix: нет отдельных product URL — варианты извлечены из category pages.",
      "Алкогольное пиво (/beer/) не импортируется.",
      "Холодный чай упомянут на /products/, отдельной страницы в sitemap нет — gap.",
      "Apply не выполняется на этапе discover.",
    ],
  };

  writeFileSync(
    path.join(out_dir, "discovered.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(out_dir, "variants.csv"),
    to_csv(
      unique_variants.map((v) => ({
        line: v.line,
        brand: v.brand,
        product_name: v.product_name,
        taste: v.taste,
        carbonation: v.carbonation,
        volume_ml: v.volume_ml,
        volume_text: v.volume_text,
        package: v.package,
        source_url: v.source_url,
        source_section: v.source_section,
        confidence: v.confidence,
        notes: v.notes,
      })),
    ),
    "utf8",
  );

  const report = `# Daryal discover report

**When:** ${payload.discovered_at}  
**Scope:** non-alcoholic only  
**Output:** \`${path.relative(ROOT, out_dir)}\`

## Sources
${DARYAL_OFFICIAL_SOURCES.map((s) => `- ${s.name}: ${s.url ?? "(local PDF optional)"}`).join("\n")}

## Counts
| Metric | Value |
|--------|------:|
| Pages fetched | ${pages.length} |
| Unique variants | **${unique_variants.length}** |
| Complete (volume+package) | **${payload.complete_variants}** |
| Incomplete | **${payload.incomplete_variants}** |
| Alcoholic excluded (beer names) | ${skipped_alcohol.length} |
| Manual gaps | ${manual_gaps.length} |

## By line
| Line | Count |
|------|------:|
| gazirovannye | ${unique_variants.filter((v) => v.line === "gazirovannye").length} |
| water | ${unique_variants.filter((v) => v.line === "water").length} |
| juice_still | ${unique_variants.filter((v) => v.line === "juice_still").length} |

## Manual gaps
${manual_gaps.length ? manual_gaps.map((g) => `- **${g.page}**: ${g.reason} — ${g.evidence}`).join("\n") : "_none_"}

## Next
\`\`\`bash
npm run import:daryal:dry-run -- --from ${path.relative(ROOT, out_dir)}
\`\`\`
`;
  writeFileSync(path.join(out_dir, "DISCOVER-REPORT.md"), report, "utf8");

  // seed-discover + latest
  ensure_dir(path.join(ARTIFACTS_ROOT, "seed-discover"));
  copyFileSync(
    path.join(out_dir, "discovered.json"),
    path.join(ARTIFACTS_ROOT, "seed-discover", "discovered.json"),
  );
  link_latest(out_dir, "latest-discover");

  console.log(report);
  console.log(`Wrote ${path.relative(ROOT, out_dir)}`);
  void args;
}

function propose_from_variants(
  variants: DiscoveredVariant[],
  categories: ExistingCategory[],
  existing: ExistingCatalogProduct[],
): { proposed: ProposedProduct[]; manual: ManualReviewItem[] } {
  const proposed: ProposedProduct[] = [];
  const manual: ManualReviewItem[] = [];
  const used_skus = new Set(existing.map((p) => p.sku.toUpperCase()));

  for (const v of variants) {
    if (v.alcohol_scope === "alcoholic_excluded") {
      manual.push({
        official_name: v.product_name,
        brand: v.brand,
        source_url: v.source_url,
        reason: "alcoholic_excluded",
        evidence: v.notes || "alcohol",
        suggested_action: "skip",
      });
      continue;
    }

    if (v.volume_ml == null || !v.package || !v.volume_text) {
      manual.push({
        official_name: v.product_name,
        brand: v.brand,
        source_url: v.source_url,
        reason: "missing_volume_or_package",
        evidence: v.notes || v.source_section,
        suggested_action: "confirm volume/package from PDF or manufacturer",
      });
      continue;
    }

    const cat = classify_variant(v, categories);
    let product_key = v.taste || v.product_name;
    if (v.line === "water") {
      product_key =
        v.carbonation === "газированная" ? "GAZ" : "STILL";
    } else if (
      !v.taste &&
      product_key.toLowerCase().startsWith(v.brand.toLowerCase())
    ) {
      product_key = product_key.slice(v.brand.length).trim() || product_key;
    }
    let sku = build_daryal_sku({
      brand: v.brand,
      product_key,
      volume_ml: v.volume_ml,
      package: v.package,
    });
    if (used_skus.has(sku)) {
      let n = 2;
      let alt = `${sku}-V${n}`;
      while (alt.length > 64 || used_skus.has(alt)) {
        n += 1;
        alt = `${sku.slice(0, 60)}-V${n}`;
      }
      sku = alt;
    }
    used_skus.add(sku);

    const name = build_daryal_name({
      brand: v.brand,
      product_name: v.product_name,
      taste: v.taste,
      carbonation: v.carbonation,
      volume_text: v.volume_text,
      package: v.package,
    });

    const dup = existing.find(
      (p) =>
        (p.brand || "").toLowerCase().includes("дарьял") &&
        p.name.toLowerCase().includes((v.taste || v.product_name).toLowerCase()),
    );

    proposed.push({
      proposed_sku: sku,
      official_name: v.product_name,
      proposed_name: name,
      brand: v.brand,
      manufacturer: "ООО ВПБЗ «Дарьял»",
      category: cat.category,
      category_slug: cat.category_slug,
      category_reason: cat.category_reason,
      volume: v.volume_text,
      package: v.package_label || v.package,
      package_code: v.package,
      taste: v.taste,
      carbonation: v.carbonation,
      alcohol_percent: 0,
      source_url: v.source_url,
      image_url: v.image_url,
      duplicate_status: dup ? "possible_duplicate" : "new",
      confidence: v.confidence,
      notes: [v.notes, dup ? `possible match existing sku=${dup.sku}` : ""]
        .filter(Boolean)
        .join(" | "),
      import_status: dup || !cat.exists ? "manual_review" : "proposed",
      description: [
        "Производитель: ООО ВПБЗ «Дарьял»",
        `Бренд: ${v.brand}`,
        v.taste ? `Вкус: ${v.taste}` : null,
        v.carbonation ? `Газация: ${v.carbonation}` : null,
        `Источник: ${v.source_url}`,
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  return { proposed, manual };
}

async function cmd_dry_run(args: string[]) {
  let from: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = args[++i];
  }

  const discover_dir = from
    ? path.isAbsolute(from)
      ? from
      : path.join(ROOT, from)
    : path.join(ARTIFACTS_ROOT, "seed-discover");

  const discovered_path = path.join(discover_dir, "discovered.json");
  if (!existsSync(discovered_path)) {
    throw new Error(
      `No discovered.json at ${discovered_path}. Run: npm run import:daryal:discover`,
    );
  }

  const discovered = JSON.parse(readFileSync(discovered_path, "utf8")) as {
    variants: DiscoveredVariant[];
    skipped_alcohol?: SkippedAlcoholicItem[];
    manual_gaps?: Array<{ page: string; reason: string; evidence: string }>;
  };

  const categories = await load_tinda_categories();
  const { items: existing, warning: existing_warning } =
    await load_tinda_products();
  if (existing_warning) console.warn(existing_warning);
  const { proposed, manual } = propose_from_variants(
    discovered.variants,
    categories,
    existing,
  );

  const out_dir = path.join(ARTIFACTS_ROOT, `${stamp()}-dry-run`);
  ensure_dir(out_dir);

  const manifest = {
    kind: "daryal-dry-run",
    created_at: new Date().toISOString(),
    manufacturer: "Дарьял",
    scope: "non_alcoholic_only",
    source_discover: path.relative(ROOT, discover_dir),
    policy: {
      sales_status: "showcase",
      price_amount: null,
      orderable: false,
      create_only: true,
      merge_forbidden: true,
      alcohol_excluded: true,
      apply_implemented: false,
      note: "price_amount=null maps user intent price=0 / not orderable under catalog schema",
    },
    existing_catalog_warning: existing_warning,
    counts: {
      proposed: proposed.filter((p) => p.import_status === "proposed").length,
      manual_review: proposed.filter((p) => p.import_status === "manual_review").length +
        manual.length,
      skipped_alcohol: (discovered.skipped_alcohol || []).length,
      existing_catalog: existing.length,
    },
    sha256_proposed: createHash("sha256")
      .update(JSON.stringify(proposed))
      .digest("hex"),
  };

  writeFileSync(path.join(out_dir, "dry-run-manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(out_dir, "proposed-products.json"), JSON.stringify(proposed, null, 2));
  writeFileSync(
    path.join(out_dir, "proposed-products.csv"),
    to_csv(
      proposed.map((p) => ({
        proposed_sku: p.proposed_sku,
        proposed_name: p.proposed_name,
        brand: p.brand,
        category: p.category,
        category_slug: p.category_slug,
        volume: p.volume,
        package: p.package,
        taste: p.taste,
        carbonation: p.carbonation,
        source_url: p.source_url,
        confidence: p.confidence,
        import_status: p.import_status,
        duplicate_status: p.duplicate_status,
        notes: p.notes,
      })),
    ),
  );
  writeFileSync(
    path.join(out_dir, "manual-review.csv"),
    to_csv([
      ...manual.map((m) => ({
        official_name: m.official_name,
        brand: m.brand,
        source_url: m.source_url,
        reason: m.reason,
        evidence: m.evidence,
        suggested_action: m.suggested_action,
      })),
      ...proposed
        .filter((p) => p.import_status === "manual_review")
        .map((p) => ({
          official_name: p.official_name,
          brand: p.brand,
          source_url: p.source_url,
          reason: p.duplicate_status === "possible_duplicate" ? "possible_duplicate" : "needs_review",
          evidence: p.notes,
          suggested_action: "human review before apply",
        })),
    ]),
  );
  writeFileSync(
    path.join(out_dir, "skipped-alcohol.csv"),
    to_csv(
      (discovered.skipped_alcohol || []).map((s) => ({
        name: s.name,
        source_url: s.source_url,
        evidence: s.evidence,
      })),
    ),
  );

  const ready = proposed.filter((p) => p.import_status === "proposed");
  const report = `# Daryal dry-run report

**When:** ${manifest.created_at}  
**From discover:** \`${manifest.source_discover}\`  
**Output:** \`${path.relative(ROOT, out_dir)}\`

## Policy
- create-only, showcase, \`price_amount=null\`
- alcohol excluded
- **apply not implemented yet** (stage 1)

## Counts
| Metric | Value |
|--------|------:|
| Proposed ready | **${ready.length}** |
| Manual review | **${manifest.counts.manual_review}** |
| Alcohol skipped | ${manifest.counts.skipped_alcohol} |
| TINDA catalog size | ${manifest.counts.existing_catalog} |

## Category mix (ready)
${Object.entries(
  ready.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {}),
)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n") || "_none_"}

## Sample SKUs
${ready
  .slice(0, 12)
  .map((p) => `- \`${p.proposed_sku}\` — ${p.proposed_name}`)
  .join("\n")}

## Blockers before apply
1. Human review of proposed + manual CSVs
2. Optional PDF catalog (if manufacturer provides)
3. Confirm cold-tea / other lines missing from site
4. Implement gated \`apply\` (backup flags, create-only) — **not in this stage**
`;

  writeFileSync(path.join(out_dir, "DRY-RUN-REPORT.md"), report, "utf8");
  link_latest(out_dir, "latest-dry-run");
  console.log(report);
}

function arg_value(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  return undefined;
}

function validate_backup(
  backup_path: string,
): { ok: true; size: number; sha256: string } | { ok: false; error: string } {
  if (!existsSync(backup_path)) {
    return { ok: false, error: `backup file not found: ${backup_path}` };
  }
  const st = readFileSync(backup_path);
  if (!st.length) {
    return { ok: false, error: `backup file is empty: ${backup_path}` };
  }
  const head = st.subarray(0, Math.min(64, st.length)).toString("utf8");
  const looks_sql =
    head.includes("PostgreSQL") ||
    head.includes("pg_dump") ||
    head.includes("CREATE TABLE") ||
    head.includes("--") ||
    st[0] === 0x50 ||
    st[0] === 0x1f;
  if (!looks_sql && st.length < 1024) {
    return {
      ok: false,
      error: `backup file looks too small/unreadable as DB dump (${st.length} bytes)`,
    };
  }
  const sha256 = createHash("sha256").update(st).digest("hex");
  return { ok: true, size: st.length, sha256 };
}

type ApprovedRow = {
  proposed_sku: string;
  proposed_name: string;
  brand?: string;
  category?: string;
  category_slug?: string;
  volume?: string;
  package?: string;
  taste?: string;
  source_url?: string;
  image_path?: string;
  manufacturer?: string;
};

type ApplyManifest = {
  stage?: string;
  approved_count?: number;
  approved_skus?: string[];
  manual_names?: string[];
  categories?: Array<{ name: string; slug: string }>;
  categories_to_create?: Array<{ name: string; slug: string }>;
  apply?: {
    sales_status?: string;
    is_active?: boolean;
    price_amount?: number | null;
    orderable?: boolean;
    create_only?: boolean;
    modify_existing_products?: boolean;
    availability?: string;
  };
};

function parse_csv_rows(text: string): ApprovedRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: ApprovedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
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

function load_image_for_row(
  row: ApprovedRow,
): { buffer: Buffer; filename: string } | null {
  const local = (row.image_path || "").trim();
  if (!local) return null;
  const abs = path.isAbsolute(local) ? local : path.join(ROOT, local);
  if (!existsSync(abs)) return null;
  const buffer = readFileSync(abs);
  if (buffer.length < 100) return null;
  // Accept prepared WebP (RIFF....WEBP)
  if (!(buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57)) {
    // still allow; upload_product_image will re-encode/validate
  }
  return { buffer, filename: path.basename(abs) };
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
      "APPLY BLOCKED: pass --manifest <path to approved-import-manifest.json>",
    );
    process.exitCode = 2;
    return;
  }
  if (process.argv.includes("--merge")) {
    console.error("APPLY BLOCKED: --merge is not allowed for Daryal import");
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("APPLY BLOCKED: DATABASE_URL is not set in this environment");
    process.exitCode = 2;
    return;
  }

  const backup = validate_backup(backup_path);
  if (backup.ok === false) {
    console.error(`APPLY BLOCKED: ${backup.error}`);
    process.exitCode = 2;
    return;
  }
  if (!existsSync(manifest_path)) {
    console.error(`APPLY BLOCKED: manifest not found: ${manifest_path}`);
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as ApplyManifest;
  if ((manifest.categories_to_create || []).length > 0) {
    console.error(
      "APPLY BLOCKED: categories_to_create must be empty; Daryal apply never creates categories",
    );
    process.exitCode = 2;
    return;
  }
  if (!manifest.approved_skus?.length) {
    console.error("APPLY BLOCKED: manifest has no approved_skus");
    process.exitCode = 2;
    return;
  }
  if (manifest.approved_skus.length !== EXPECTED_APPROVED) {
    console.error(
      `APPLY BLOCKED: expected ${EXPECTED_APPROVED} approved SKUs, got ${manifest.approved_skus.length}`,
    );
    process.exitCode = 2;
    return;
  }
  if (new Set(manifest.approved_skus).size !== EXPECTED_APPROVED) {
    console.error("APPLY BLOCKED: approved_skus are not unique");
    process.exitCode = 2;
    return;
  }
  if (manifest.apply?.modify_existing_products === true) {
    console.error("APPLY BLOCKED: modify_existing_products must be false");
    process.exitCode = 2;
    return;
  }
  if (manifest.apply?.create_only === false) {
    console.error("APPLY BLOCKED: create_only must be true");
    process.exitCode = 2;
    return;
  }

  const manifest_dir = path.dirname(manifest_path);
  const approved_csv = path.join(manifest_dir, "approved-products.csv");
  if (!existsSync(approved_csv)) {
    console.error(`APPLY BLOCKED: approved-products.csv missing next to manifest`);
    process.exitCode = 2;
    return;
  }

  const manual_csv = path.join(manifest_dir, "manual-review.csv");
  const rejected_csv = path.join(manifest_dir, "rejected-products.csv");
  const manual_text = existsSync(manual_csv) ? readFileSync(manual_csv, "utf8") : "";
  const rejected_text = existsSync(rejected_csv)
    ? readFileSync(rejected_csv, "utf8")
    : "";
  for (const needle of ["Мультифрукт", "Красный апельсин", "Фрутимикс"]) {
    if (!manual_text.includes(needle)) {
      console.error(`APPLY BLOCKED: manual-review.csv missing expected row: ${needle}`);
      process.exitCode = 2;
      return;
    }
  }
  for (const needle of ["Грейпфрут", "пиво", "ФИЕСТА", "Сокосодержащие"]) {
    if (!rejected_text.toLowerCase().includes(needle.toLowerCase())) {
      console.error(`APPLY BLOCKED: rejected-products.csv missing expected row: ${needle}`);
      process.exitCode = 2;
      return;
    }
  }

  const approved_rows = parse_csv_rows(readFileSync(approved_csv, "utf8")).filter((r) =>
    manifest.approved_skus!.includes(r.proposed_sku),
  );
  if (approved_rows.length !== EXPECTED_APPROVED) {
    console.error(
      `APPLY BLOCKED: approved CSV rows matching manifest = ${approved_rows.length}, expected ${EXPECTED_APPROVED}`,
    );
    process.exitCode = 2;
    return;
  }

  const sku_counts = new Map<string, number>();
  for (const row of approved_rows) {
    const sku = row.proposed_sku.trim();
    sku_counts.set(sku, (sku_counts.get(sku) || 0) + 1);
    const blob = `${sku} ${row.proposed_name} ${row.brand || ""}`.toLowerCase();
    if (FORBIDDEN_NAME_NEEDLES.some((n) => blob.includes(n))) {
      console.error(`APPLY BLOCKED: forbidden manual/rejected content in approved set: ${sku}`);
      process.exitCode = 2;
      return;
    }
    if (!row.proposed_name?.trim() || !row.brand?.trim() || !row.category?.trim()) {
      console.error(`APPLY BLOCKED: incomplete row ${sku}`);
      process.exitCode = 2;
      return;
    }
    if (!row.volume?.trim() || !row.package?.trim()) {
      console.error(`APPLY BLOCKED: missing volume/package for ${sku}`);
      process.exitCode = 2;
      return;
    }
    if (!row.source_url?.trim()) {
      console.error(`APPLY BLOCKED: missing source_url for ${sku}`);
      process.exitCode = 2;
      return;
    }
    const img = load_image_for_row(row);
    if (!img) {
      console.error(`APPLY BLOCKED: missing/unreadable image for ${sku} (${row.image_path})`);
      process.exitCode = 2;
      return;
    }
    if (!(img.buffer[0] === 0x52 && img.buffer[8] === 0x57)) {
      console.error(`APPLY BLOCKED: image for ${sku} is not WebP/RIFF`);
      process.exitCode = 2;
      return;
    }
  }
  const collisions = Array.from(sku_counts.entries())
    .filter(([, n]) => n > 1)
    .map(([s]) => s);
  if (collisions.length) {
    console.error(`APPLY BLOCKED: SKU collisions in approved set: ${collisions.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const soda_count = approved_rows.filter((r) => r.category === "Газированные напитки").length;
  const water_count = approved_rows.filter((r) => r.category === "Минеральная вода").length;
  if (soda_count !== EXPECTED_SODA || water_count !== EXPECTED_WATER) {
    console.error(
      `APPLY BLOCKED: category distribution soda=${soda_count} water=${water_count} (expected ${EXPECTED_SODA}/${EXPECTED_WATER})`,
    );
    process.exitCode = 2;
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const apply_out = path.join(ARTIFACTS_ROOT, `${stamp()}-apply`);
  ensure_dir(apply_out);

  type Fingerprint = {
    sku: string;
    name: string;
    brand: string | null;
    category_id: string;
    price_amount: string | null;
    availability: string;
    sales_status: string;
    image_url: string | null;
    updated_at: string;
  };

  const result = {
    started_at: new Date().toISOString(),
    backup_path,
    backup_size: backup.size,
    backup_sha256: backup.sha256,
    manifest_path,
    approved_csv,
    approved_input_count: approved_rows.length,
    created: [] as string[],
    skipped_existing: [] as string[],
    images_uploaded: [] as string[],
    images_missing: [] as string[],
    errors: [] as Array<{ sku: string; error: string }>,
    categories_created: [] as string[],
    required_categories_missing: [] as string[],
    category_ids: {} as Record<string, string>,
    existing_products_edited: false,
    existing_fingerprint_mismatches: [] as string[],
    category_distribution_created: {} as Record<string, number>,
    catalog_total_before: null as number | null,
    catalog_total_after: null as number | null,
    daryal_count_after: null as number | null,
  };

  try {
    const before = await prisma.products.findMany({
      select: {
        sku: true,
        name: true,
        brand: true,
        category_id: true,
        price_amount: true,
        availability: true,
        sales_status: true,
        image_url: true,
        updated_at: true,
      },
    });
    const before_map = new Map<string, Fingerprint>(
      before.map((p) => [
        p.sku,
        {
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          category_id: p.category_id,
          price_amount: p.price_amount === null ? null : String(p.price_amount),
          availability: p.availability,
          sales_status: p.sales_status,
          image_url: p.image_url,
          updated_at: p.updated_at.toISOString(),
        },
      ]),
    );
    result.catalog_total_before = before.length;
    writeFileSync(
      path.join(apply_out, "existing-products-before.json"),
      JSON.stringify(Array.from(before_map.values()), null, 2),
    );

    // Pre-check: none of approved SKUs already exist (informational; apply will skip)
    const already = approved_rows
      .map((r) => r.proposed_sku)
      .filter((sku) => before_map.has(sku));
    writeFileSync(
      path.join(apply_out, "pre-existing-approved-skus.json"),
      JSON.stringify(already, null, 2),
    );

    // Resolve required categories — NEVER create
    const category_id_by_slug = new Map<string, string>();
    for (const [name, slug] of Object.entries(CATEGORY_SLUG_BY_NAME)) {
      const by_slug = await prisma.categories.findUnique({ where: { slug } });
      const by_name = by_slug
        ? null
        : await prisma.categories.findFirst({ where: { name } });
      const cat = by_slug || by_name;
      if (!cat) {
        result.required_categories_missing.push(`${name} (${slug})`);
        continue;
      }
      category_id_by_slug.set(slug, cat.id);
      result.category_ids[slug] = cat.id;
    }
    if (result.required_categories_missing.length) {
      writeFileSync(
        path.join(apply_out, "apply-result.json"),
        JSON.stringify(
          {
            ...result,
            finished_at: new Date().toISOString(),
            blocked: "required_categories_missing",
            created_count: 0,
            skipped_count: 0,
            error_count: result.required_categories_missing.length,
          },
          null,
          2,
        ),
      );
      console.error(
        `APPLY BLOCKED: required_categories_missing: ${result.required_categories_missing.join(", ")}`,
      );
      process.exitCode = 2;
      return;
    }

    const sales_status = manifest.apply?.sales_status || "showcase";
    const availability = manifest.apply?.availability || "on_order";
    const is_active = manifest.apply?.is_active ?? true;

    for (const row of approved_rows) {
      const sku = row.proposed_sku.trim();
      try {
        const existing = await prisma.products.findUnique({ where: { sku } });
        if (existing) {
          result.skipped_existing.push(sku);
          continue;
        }
        const cat_name = row.category || "";
        const slug = row.category_slug || CATEGORY_SLUG_BY_NAME[cat_name];
        if (!slug) throw new Error(`No slug mapping for category ${cat_name}`);
        const category_id = category_id_by_slug.get(slug);
        if (!category_id) throw new Error(`No category id for ${cat_name} (${slug})`);

        const description = [
          "Производитель: ООО ВПБЗ «Дарьял»",
          row.brand?.trim() ? `Бренд: ${row.brand.trim()}` : null,
          row.taste ? `Вкус: ${row.taste}` : null,
          row.source_url ? `Источник: ${row.source_url}` : null,
          "Импорт: Дарьял non-alcoholic catalog (showcase, без цены, заказ недоступен)",
        ]
          .filter(Boolean)
          .join("\n");

        const created = await prisma.products.create({
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
            image_url: null,
            is_promo: false,
            is_new: true,
            is_hit: false,
          },
        });

        const img = load_image_for_row(row);
        if (!img) {
          result.images_missing.push(sku);
          result.errors.push({ sku, error: "image missing after create" });
        } else {
          const stored = await upload_product_image({
            product_id: created.id,
            buffer: img.buffer,
            filename: img.filename,
            mime_type: "image/webp",
          });
          await prisma.products.update({
            where: { id: created.id },
            data: { image_url: stored.image_url },
          });
          result.images_uploaded.push(sku);
        }

        result.created.push(sku);
        result.category_distribution_created[cat_name] =
          (result.category_distribution_created[cat_name] || 0) + 1;
      } catch (err) {
        result.errors.push({
          sku,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Verify existing products untouched
    const after_existing = await prisma.products.findMany({
      where: { sku: { in: Array.from(before_map.keys()) } },
      select: {
        sku: true,
        name: true,
        brand: true,
        category_id: true,
        price_amount: true,
        availability: true,
        sales_status: true,
        image_url: true,
        updated_at: true,
      },
    });
    for (const p of after_existing) {
      const prev = before_map.get(p.sku);
      if (!prev) continue;
      const cur: Fingerprint = {
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category_id: p.category_id,
        price_amount: p.price_amount === null ? null : String(p.price_amount),
        availability: p.availability,
        sales_status: p.sales_status,
        image_url: p.image_url,
        updated_at: p.updated_at.toISOString(),
      };
      if (
        prev.name !== cur.name ||
        prev.brand !== cur.brand ||
        prev.category_id !== cur.category_id ||
        prev.price_amount !== cur.price_amount ||
        prev.availability !== cur.availability ||
        prev.sales_status !== cur.sales_status ||
        prev.image_url !== cur.image_url
      ) {
        result.existing_fingerprint_mismatches.push(p.sku);
        result.existing_products_edited = true;
      }
    }

    // Leak checks: manual/rejected names must not appear as new SKUs
    const leak_candidates = await prisma.products.findMany({
      where: {
        OR: [
          { name: { contains: "Фрутимикс", mode: "insensitive" } },
          { name: { contains: "ФИЕСТА", mode: "insensitive" } },
          { name: { contains: "Грейпфрут-малина", mode: "insensitive" } },
          { sku: { startsWith: "DARYAL-" }, brand: { contains: "пиво", mode: "insensitive" } },
        ],
      },
      select: { sku: true, name: true },
    });
    for (const p of leak_candidates) {
      if (!before_map.has(p.sku)) {
        result.errors.push({
          sku: p.sku,
          error: `LEAK: manual/rejected product appeared after apply (${p.name})`,
        });
      }
    }

    result.catalog_total_after = await prisma.products.count();
    result.daryal_count_after = await prisma.products.count({
      where: { sku: { startsWith: "DARYAL-" } },
    });
  } finally {
    await prisma.$disconnect();
  }

  const finished = {
    ...result,
    finished_at: new Date().toISOString(),
    created_count: result.created.length,
    skipped_count: result.skipped_existing.length,
    error_count: result.errors.length,
    images_uploaded_count: result.images_uploaded.length,
    images_missing_count: result.images_missing.length,
  };
  writeFileSync(path.join(apply_out, "apply-result.json"), JSON.stringify(finished, null, 2));
  writeFileSync(
    path.join(apply_out, "APPLY-REPORT.md"),
    `# Daryal apply report

- backup: \`${backup_path}\`
- backup size: **${backup.size}** bytes
- backup SHA-256: \`${backup.sha256}\`
- manifest: \`${manifest_path}\`
- approved csv: \`${approved_csv}\`
- approved input: **${finished.approved_input_count}**
- created: **${finished.created_count}**
- skipped existing: **${finished.skipped_count}**
- errors: **${finished.error_count}**
- images uploaded: **${finished.images_uploaded_count}**
- images missing: **${finished.images_missing_count}**
- catalog total before/after: **${finished.catalog_total_before ?? "—"}** → **${finished.catalog_total_after ?? "—"}**
- DARYAL- SKUs after: **${finished.daryal_count_after ?? "—"}**
- categories created: ${finished.categories_created.join(", ") || "— (none; create forbidden)"}
- category ids: ${JSON.stringify(finished.category_ids)}
- existing products edited: **${finished.existing_products_edited}**
- fingerprint mismatches: ${finished.existing_fingerprint_mismatches.join(", ") || "—"}

## Category distribution (created)

${
  Object.entries(finished.category_distribution_created)
    .map(([k, v]) => `- ${k}: **${v}**`)
    .join("\n") || "_none_"
}

## Created SKUs

${finished.created.map((s) => `- \`${s}\``).join("\n") || "_none_"}

## Skipped existing

${finished.skipped_existing.map((s) => `- \`${s}\``).join("\n") || "_none_"}

## Errors

${
  finished.errors.map((e) => `- \`${e.sku}\`: ${e.error}`).join("\n") || "_none_"
}
`,
    "utf8",
  );

  const latest = path.join(ARTIFACTS_ROOT, "latest-apply");
  try {
    if (existsSync(latest)) unlinkSync(latest);
  } catch {
    /* ignore */
  }
  try {
    symlinkSync(path.basename(apply_out), latest);
  } catch {
    writeFileSync(latest + ".txt", apply_out);
  }

  console.log(
    JSON.stringify(
      {
        apply_out,
        created_count: finished.created_count,
        skipped_count: finished.skipped_count,
        error_count: finished.error_count,
        images_uploaded_count: finished.images_uploaded_count,
        existing_products_edited: finished.existing_products_edited,
        catalog_total_before: finished.catalog_total_before,
        catalog_total_after: finished.catalog_total_after,
        daryal_count_after: finished.daryal_count_after,
        category_distribution_created: finished.category_distribution_created,
        backup_sha256: finished.backup_sha256,
      },
      null,
      2,
    ),
  );

  if (finished.error_count > 0 || finished.existing_products_edited) {
    process.exitCode = 1;
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  ensure_dir(ARTIFACTS_ROOT);
  if (cmd === "discover") return cmd_discover(args);
  if (cmd === "dry-run") return cmd_dry_run(args);
  if (cmd === "apply") return cmd_apply();
  console.error("Usage: import-daryal.ts <discover|dry-run|apply> [...args]");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
