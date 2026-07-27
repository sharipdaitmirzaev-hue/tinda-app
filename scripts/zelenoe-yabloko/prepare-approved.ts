#!/usr/bin/env node
/**
 * Prepare staging for approved_existing + draft workbook for approved_new.
 *
 * Does NOT upload to VPS, change image_url, create DB products, or delete old photos.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import {
  process_product_image_buffer,
  validate_product_image,
  build_product_image_storage_key,
} from "../../src/lib/storage/product-images";
import {
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
} from "../../src/lib/catalog/external-images/normalize";
import {
  build_zy_sku,
  dedupe_key,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";
import { score_candidate_match } from "../../src/lib/catalog/external-images/match";
import type {
  ExternalImageCandidate,
  TindaProductImageTarget,
} from "../../src/lib/catalog/external-images/types";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve("data/imports/zelenoe-yabloko-images");
const CATEGORY_SLUG = "gazirovannye-napitki";

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function package_compatible(a: string | null | undefined, b: string | null | undefined) {
  const na = normalize_package(a || "");
  const nb = normalize_package(b || "");
  return !!na && !!nb && na === nb;
}

function volume_compatible(a: string | null | undefined, b: string | null | undefined) {
  const va = parse_volume_ml(a);
  const vb = parse_volume_ml(b);
  return va != null && vb != null && va === vb;
}

function sugar_compatible(a: string, b: string) {
  const sa = sugar_free_flag(a);
  const sb = sugar_free_flag(b);
  if (sa == null || sb == null) return sa == null && sb == null ? true : false;
  return sa === sb;
}

async function stage_existing() {
  const decisions = JSON.parse(
    readFileSync(path.join(ROOT, "review-decisions.json"), "utf8"),
  ) as { items: Array<Record<string, unknown>> };
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
  ) as { items: Array<Record<string, unknown>> };
  const manifest_by_index = new Map(
    manifest.items.map((m) => [Number(m.source_index), m]),
  );
  const gallery = JSON.parse(
    readFileSync(path.join(ROOT, "gallery-data.json"), "utf8"),
  ) as { cards: Array<Record<string, unknown>> };
  const gallery_by_index = new Map(
    gallery.cards.map((c) => [Number(c.source_index), c]),
  );

  const products_path = path.resolve(
    arg("products", "data/imports/tinda_active_products.snapshot.json")!,
  );
  const products = JSON.parse(
    readFileSync(products_path, "utf8"),
  ) as TindaProductImageTarget[];
  const active_snapshot_path = path.join(
    ROOT,
    "tinda-approved-existing-snapshot.json",
  );
  const active_rows = existsSync(active_snapshot_path)
    ? (JSON.parse(readFileSync(active_snapshot_path, "utf8")) as Array<
        Record<string, unknown>
      >)
    : [];
  const active_by_sku = new Map(active_rows.map((r) => [String(r.sku), r]));

  const staging_dir = path.join(ROOT, "staging-existing");
  mkdirSync(staging_dir, { recursive: true });

  const selected = decisions.items.filter(
    (i) => String(i.review_status) === "approved_existing",
  );

  const plan_items: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  let staged = 0;

  for (const row of selected) {
    const sku = String(row.tinda_sku || "");
    const product_id = String(row.tinda_product_id || "");
    const source_index = Number(row.source_index);
    const g = gallery_by_index.get(source_index);
    const m = manifest_by_index.get(source_index);
    const tinda =
      products.find((p) => p.id === product_id) ||
      products.find((p) => p.sku === sku) ||
      null;
    const active = active_by_sku.get(sku) || null;

    const validation_errors: string[] = [];
    if (!product_id) validation_errors.push("missing_product_id");
    if (!sku) validation_errors.push("missing_sku");
    if (!tinda) validation_errors.push("product_not_in_snapshot");
    if (active && active.is_active === false) validation_errors.push("product_inactive");
    if (active && !active.is_active && active.is_active !== true) {
      // if snapshot missing is_active, fall back to presence
    }
    if (!active) validation_errors.push("active_snapshot_missing_sku");
    else if (active.is_active !== true) validation_errors.push("product_inactive");

    const source_name = String(row.source_name || g?.source_name || "");
    const brand = String(g?.brand || "");
    if (tinda && !normalize_brand(brand || source_name).includes(normalize_brand(tinda.brand || "")) &&
        normalize_brand(tinda.brand || "") !== normalize_brand(brand)) {
      // softer brand check
      const tb = normalize_brand(tinda.brand || "");
      const sb = normalize_brand(brand);
      if (!tb || !sb || (tb !== sb && !tb.includes(sb) && !sb.includes(tb))) {
        validation_errors.push("brand_mismatch");
      }
    }
    if (tinda && !volume_compatible(String(g?.volume_text || ""), tinda.volume_text)) {
      validation_errors.push("volume_mismatch");
    }
    if (
      tinda &&
      !package_compatible(
        String(g?.package_type || ""),
        tinda.package_type || tinda.name,
      )
    ) {
      validation_errors.push("package_mismatch");
    }
    if (tinda && !sugar_compatible(source_name, tinda.name)) {
      validation_errors.push("sugar_version_mismatch");
    }

    const original_path = String(
      row.local_original_path || m?.local_original_path || "",
    );
    if (!original_path || !existsSync(original_path)) {
      validation_errors.push("original_missing");
    }

    let buffer: Buffer | null = null;
    let actual_sha = "";
    if (original_path && existsSync(original_path)) {
      buffer = readFileSync(original_path);
      actual_sha = sha256(buffer);
      const expected = String(row.sha256 || m?.sha256 || "");
      if (expected && actual_sha !== expected) {
        validation_errors.push("sha256_mismatch");
      }
      try {
        await sharp(buffer, { failOn: "error" }).metadata();
      } catch {
        validation_errors.push("image_corrupt");
      }
    }

    if (validation_errors.length > 0 || !buffer || !tinda) {
      errors.push({
        sku,
        product_id,
        source_index,
        validation_errors,
      });
      plan_items.push({
        product_id,
        sku,
        product_name: tinda?.name || String(row.tinda_name || ""),
        old_image_url: tinda?.image_url || String(g?.current_image_url || ""),
        source_product_url: String(row.source_product_url || ""),
        original_local_path: original_path,
        staged_webp_path: "",
        width: null,
        height: null,
        file_size: null,
        sha256: actual_sha || String(row.sha256 || ""),
        upload_target_path: product_id
          ? `products/${product_id}/<uuid>.webp`
          : "",
        apply_status: "blocked_validation",
        validation_errors,
      });
      continue;
    }

    try {
      validate_product_image({ buffer, filename: path.basename(original_path) });
      const processed = await process_product_image_buffer(buffer);
      const meta = await sharp(processed, { failOn: "error" }).metadata();
      const staged_name = `${sku}.staged.webp`;
      const staged_path = path.join(staging_dir, staged_name);
      writeFileSync(staged_path, processed);
      const storage_key = build_product_image_storage_key(product_id);
      staged += 1;
      plan_items.push({
        product_id,
        sku,
        product_name: tinda.name,
        old_image_url: tinda.image_url || String(g?.current_image_url || ""),
        source_product_url: String(row.source_product_url || ""),
        original_local_path: original_path,
        staged_webp_path: staged_path,
        width: meta.width ?? null,
        height: meta.height ?? null,
        file_size: processed.length,
        sha256: sha256(processed),
        upload_target_path: storage_key,
        apply_status: "pending",
        validation_errors: [],
        source_index,
        match_score: row.match_score ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ sku, product_id, error: msg });
      plan_items.push({
        product_id,
        sku,
        product_name: tinda.name,
        old_image_url: tinda.image_url || "",
        source_product_url: String(row.source_product_url || ""),
        original_local_path: original_path,
        staged_webp_path: "",
        width: null,
        height: null,
        file_size: null,
        sha256: actual_sha,
        upload_target_path: "",
        apply_status: "error",
        validation_errors: [msg],
      });
    }
  }

  const plan = {
    generated_at: new Date().toISOString(),
    note: "LOCAL STAGING ONLY. Do not upload to VPS. Do not change image_url. Do not delete old photos.",
    staging_dir,
    selected: selected.length,
    staged_ok: staged,
    errors,
    items: plan_items,
  };
  const plan_path = path.join(ROOT, "existing-image-update-plan.json");
  writeFileSync(plan_path, JSON.stringify(plan, null, 2));
  return { plan_path, staging_dir, selected: selected.length, staged, errors };
}

function draft_new_products() {
  const decisions = JSON.parse(
    readFileSync(path.join(ROOT, "review-decisions.json"), "utf8"),
  ) as { items: Array<Record<string, unknown>> };
  const gallery = JSON.parse(
    readFileSync(path.join(ROOT, "gallery-data.json"), "utf8"),
  ) as { cards: Array<Record<string, unknown>> };
  const gallery_by_index = new Map(
    gallery.cards.map((c) => [Number(c.source_index), c]),
  );
  const products = JSON.parse(
    readFileSync(
      path.resolve(
        arg("products", "data/imports/tinda_active_products.snapshot.json")!,
      ),
      "utf8",
    ),
  ) as TindaProductImageTarget[];

  const selected = decisions.items.filter(
    (i) => String(i.review_status) === "approved_new",
  );

  const seq_by_prefix = new Map<string, number>();
  const rows: Array<Record<string, unknown>> = [];

  for (const row of selected) {
    const idx = Number(row.source_index);
    const g = gallery_by_index.get(idx) || {};
    const source_name = String(row.source_name || g.source_name || "");
    const parsed = parse_zy_product_name(source_name);
    const brand = String(g.brand || parsed.brand || "");
    const flavor = String(g.flavor || parsed.flavor || "");
    const volume_text = String(g.volume_text || parsed.volume_text || "");
    const package_type = String(g.package_type || parsed.package_type || "");
    const prefix = `${brand}|${parsed.volume_ml}|${parsed.package_code}`;
    const seq = (seq_by_prefix.get(prefix) || 0) + 1;
    seq_by_prefix.set(prefix, seq);
    const proposed_sku =
      String(g.proposed_sku || "") ||
      build_zy_sku(brand, parsed.volume_ml, parsed.package_code, seq);

    const validation_errors: string[] = [];
    let package_requires_review = true;
    const units_per_package = 1;
    // units unknown for retail single bottles → 1 + warning
    validation_errors.push("units_per_package_unknown_default_1");

    if (!brand) validation_errors.push("brand_missing");
    if (!volume_text || parse_volume_ml(volume_text) == null) {
      validation_errors.push("volume_invalid");
    }
    if (!package_type || !normalize_package(package_type)) {
      validation_errors.push("package_invalid");
    }
    if (!flavor || flavor.length < 2) validation_errors.push("flavor_weak");

    rows.push({
      source_index: idx,
      source_name,
      brand,
      flavor,
      volume_text,
      package_type,
      source_product_url: String(row.source_product_url || g.source_product_url || ""),
      local_image_path: String(row.local_original_path || g.local_original_path || ""),
      proposed_sku,
      category_slug: CATEGORY_SLUG,
      units_per_package,
      package_requires_review,
      sales_status: "showcase",
      availability: "on_order",
      price_amount: null,
      price_currency: "RUB",
      is_active: true,
      review_status: "approved_new",
      validation_errors: validation_errors.join("|"),
      width: row.width ?? g.width ?? null,
      height: row.height ?? g.height ?? null,
      sha256: row.sha256 || "",
    });
  }

  // Internal duplicates among draft
  const seen_keys = new Map<string, number>();
  const seen_skus = new Map<string, number>();
  let internal_dupes = 0;
  let tinda_dupes = 0;
  let package_review = 0;

  for (const r of rows) {
    if (r.package_requires_review) package_review += 1;
    const key = dedupe_key({
      brand: String(r.brand),
      source_name: String(r.source_name),
      flavor: String(r.flavor),
      volume_text: String(r.volume_text),
      package_type: String(r.package_type),
      sugar_free: sugar_free_flag(String(r.source_name)),
    });
    if (seen_keys.has(key)) {
      internal_dupes += 1;
      r.validation_errors = `${r.validation_errors}|duplicate_in_draft_of_${seen_keys.get(key)}`;
    } else {
      seen_keys.set(key, Number(r.source_index));
    }

    const sku = String(r.proposed_sku);
    if (seen_skus.has(sku)) {
      r.validation_errors = `${r.validation_errors}|duplicate_proposed_sku_${seen_skus.get(sku)}`;
      internal_dupes += 1;
    } else {
      seen_skus.set(sku, Number(r.source_index));
    }

    // Existing TINDA near-duplicate check
    const candidate: ExternalImageCandidate = {
      source_site: "zelenoeyabloko.ru",
      source_product_url: String(r.source_product_url),
      candidate_image_url: "",
      source_name: String(r.source_name),
      source_brand: String(r.brand),
      source_flavor: String(r.flavor),
      source_volume: String(r.volume_text),
      source_package: String(r.package_type),
      source_priority: 3,
    };
    const hits = products
      .map((p) => score_candidate_match(p, candidate))
      .filter(
        (m) =>
          m.match_status === "exact_match" ||
          m.match_status === "probable_match" ||
          m.match_score >= 75,
      )
      .sort((a, b) => b.match_score - a.match_score);
    if (hits[0]) {
      tinda_dupes += 1;
      r.validation_errors = `${r.validation_errors}|tinda_near_duplicate_${hits[0].tinda.sku}_${hits[0].match_status}_${hits[0].match_score}`;
    }

    // Category check
    if (r.category_slug !== CATEGORY_SLUG) {
      r.validation_errors = `${r.validation_errors}|category_unexpected`;
    }
  }

  const out_xlsx = path.join(ROOT, "approved-new-products.xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        source_name: r.source_name,
        brand: r.brand,
        flavor: r.flavor,
        volume_text: r.volume_text,
        package_type: r.package_type,
        source_product_url: r.source_product_url,
        local_image_path: r.local_image_path,
        proposed_sku: r.proposed_sku,
        category_slug: r.category_slug,
        units_per_package: r.units_per_package,
        package_requires_review: r.package_requires_review,
        sales_status: r.sales_status,
        availability: r.availability,
        price_amount: r.price_amount,
        review_status: r.review_status,
        validation_errors: r.validation_errors,
      })),
    ),
    "Новые товары",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        step: 1,
        text: "Черновик only. Не создавать товары в БД. sales_status=showcase, price=NULL, on_order.",
      },
      {
        step: 2,
        text: "units_per_package=1 по умолчанию + package_requires_review=true.",
      },
    ]),
    "Инструкция",
  );
  XLSX.writeFile(wb, out_xlsx);

  const draft_json = path.join(ROOT, "approved-new-products.json");
  writeFileSync(
    draft_json,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        note: "DRAFT ONLY. Do not create products in DB.",
        count: rows.length,
        internal_duplicates: internal_dupes,
        tinda_near_duplicates: tinda_dupes,
        package_requires_review: package_review,
        items: rows,
      },
      null,
      2,
    ),
  );

  return {
    out_xlsx,
    draft_json,
    count: rows.length,
    internal_dupes,
    tinda_dupes,
    package_review,
  };
}

async function main() {
  if (process.argv.includes("--apply-production")) {
    throw new Error("Production apply disabled.");
  }
  const existing = await stage_existing();
  const neu = draft_new_products();
  const summary = {
    generated_at: new Date().toISOString(),
    existing_selected: existing.selected,
    existing_staged_webp: existing.staged,
    existing_errors: existing.errors,
    existing_plan: existing.plan_path,
    staging_existing_dir: existing.staging_dir,
    new_products_draft: neu.count,
    new_internal_duplicates: neu.internal_dupes,
    new_tinda_near_duplicates: neu.tinda_dupes,
    new_package_requires_review: neu.package_review,
    new_xlsx: neu.out_xlsx,
    new_json: neu.draft_json,
    production_changed: false,
    image_url_changed: false,
    uploaded_to_vps: false,
    products_created: false,
  };
  writeFileSync(
    path.join(ROOT, "prepare-approved-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
