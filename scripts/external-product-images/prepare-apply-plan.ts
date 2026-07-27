#!/usr/bin/env node
/**
 * Prepare local apply plan from downloaded originals.
 *
 * - Validates image
 * - Processes via product-images pipeline (EXIF rotate, strip via webp, max 1600)
 * - Writes staging webp + apply plan JSON
 *
 * Does NOT update production DB.
 * Does NOT upload to VPS.
 * Does NOT change products.image_url.
 *
 * Production apply requires a separate explicit script/flag later.
 */
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  process_product_image_buffer,
  validate_product_image,
  build_product_image_storage_key,
} from "../../src/lib/storage/product-images";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

async function main() {
  if (process.argv.includes("--apply-production")) {
    throw new Error(
      "Production apply is disabled in this script. Do not pass --apply-production.",
    );
  }

  const review_path = path.resolve(
    arg("review", "data/imports/external_product_images_review.xlsx")!,
  );
  const images_dir = path.resolve(
    arg("images-dir", "data/imports/external-product-images")!,
  );
  const staging_dir = path.resolve(
    arg("staging-dir", "data/imports/external-product-images/staging")!,
  );

  mkdirSync(staging_dir, { recursive: true });

  const wb = XLSX.readFile(review_path);
  const rows: Record<string, unknown>[] = [];
  for (const name of ["Точные совпадения", "Требует проверки"]) {
    if (!wb.Sheets[name]) continue;
    rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }));
  }

  const approved = rows.filter(
    (r) => String(r.review_status).toLowerCase() === "approved",
  );
  const files = existsSync(images_dir)
    ? readdirSync(images_dir).filter((f) => f.includes(".original."))
    : [];

  const plan = {
    generated_at: new Date().toISOString(),
    note: "LOCAL PLAN ONLY. Production backup + upload + DB update not performed.",
    items: [] as Array<Record<string, unknown>>,
    skipped: [] as Array<Record<string, unknown>>,
  };

  for (const row of approved) {
    const sku = String(row.tinda_sku || "").trim();
    const product_id = String(row.tinda_product_id || "").trim();
    const current_image_url = String(row.current_image_url || "");
    const file = files.find((f) => f.startsWith(`${sku}.original.`));
    if (!file) {
      plan.skipped.push({ sku, reason: "original_file_missing" });
      continue;
    }
    const abs = path.join(images_dir, file);
    const buffer = readFileSync(abs);
    try {
      const validated = validate_product_image({
        buffer,
        filename: file,
      });
      const processed = await process_product_image_buffer(buffer);
      const staging_name = `${sku}.processed.webp`;
      const staging_path = path.join(staging_dir, staging_name);
      writeFileSync(staging_path, processed);
      const storage_key = product_id
        ? build_product_image_storage_key(product_id)
        : null;
      plan.items.push({
        tinda_product_id: product_id,
        tinda_sku: sku,
        old_image_url: current_image_url,
        original_file: abs,
        processed_file: staging_path,
        processed_bytes: processed.length,
        validated_mime: validated.mime_type,
        proposed_storage_key: storage_key,
        candidate_image_url: String(row.candidate_image_url || ""),
        source_site: String(row.source_site || ""),
        match_score: row.match_score,
        apply_steps_when_approved: [
          "1. pg_dump backup",
          "2. save old image_url list",
          "3. upload processed webp via product-images storage",
          "4. update DB image_url only after upload success",
          "5. delete old managed local/S3 file if any",
          "6. on error keep old image_url",
        ],
      });
    } catch (e) {
      plan.skipped.push({
        sku,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const out = path.join(staging_dir, "apply-plan.json");
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify(
      {
        plan_path: out,
        prepared: plan.items.length,
        skipped: plan.skipped.length,
        production_changed: false,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
