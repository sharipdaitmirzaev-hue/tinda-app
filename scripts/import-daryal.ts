#!/usr/bin/env tsx
/**
 * Daryal (ВПБЗ «Дарьял») non-alcoholic catalog importer for TINDA Market.
 *
 * Commands:
 *   discover  — fetch official site pages, extract variants (no DB writes)
 *   dry-run   — build proposed SKUs + reports (no DB writes)
 *   apply     — gated; blocked until explicit production confirmation
 *
 * Scope: non-alcoholic only. Alcoholic beer (/beer/) is inventoried as excluded.
 * Stage 2 review/images: `npm run import:daryal:stage2` (Python).
 * Never edits existing products. Never runs without an explicit later apply gate.
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

const ROOT = process.cwd();
const ARTIFACTS_ROOT = path.join(ROOT, "artifacts", "daryal-import");

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

async function cmd_apply() {
  console.error(
    [
      "APPLY BLOCKED for Daryal.",
      "Stage 2 prepared approved-import-manifest + images under artifacts/daryal-import/latest-stage2/.",
      "Production apply requires separate explicit confirmation.",
      "Policy: create-only, showcase, price_amount=null, orderable=false; do not modify existing products.",
      "Do not write to production DB yet.",
    ].join("\n"),
  );
  process.exitCode = 2;
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
