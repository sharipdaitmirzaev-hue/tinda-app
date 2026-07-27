#!/usr/bin/env node
/**
 * Prepare local apply plan from downloaded originals.
 *
 * - Validates image
 * - Processes via product-images pipeline (EXIF rotate, strip via webp, max 1600)
 * - Writes staging webp + apply plan JSON with checksum/dimensions
 *
 * Does NOT update production DB.
 * Does NOT upload to VPS.
 * Does NOT change products.image_url.
 */
import { createHash } from "node:crypto";
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
import sharp from "sharp";
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

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function detect_ext(file: string): string {
  const m = /\.original\.([a-z0-9]+)$/i.exec(file);
  return (m?.[1] || "").toLowerCase();
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
  const preferred = ["К одобрению", "Точные совпадения", "Требует проверки"];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const name of [
    ...preferred,
    ...wb.SheetNames.filter((n: string) => !preferred.includes(n)),
  ]) {
    if (!wb.Sheets[name] || name === "Инструкция") continue;
    for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], {
      defval: "",
    }) as Record<string, unknown>[]) {
      const key = String(row.tinda_sku || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
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
    review_path,
    images_dir,
    staging_dir,
    items: [] as Array<Record<string, unknown>>,
    skipped: [] as Array<Record<string, unknown>>,
    errors: [] as Array<Record<string, unknown>>,
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
      const original_meta = await sharp(buffer, { failOn: "error" }).metadata();
      const processed = await process_product_image_buffer(buffer);
      const processed_meta = await sharp(processed, {
        failOn: "error",
      }).metadata();
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
        original_format: detect_ext(file) || validated.mime_type,
        original_bytes: buffer.length,
        original_width: original_meta.width ?? null,
        original_height: original_meta.height ?? null,
        original_checksum_sha256: sha256(buffer),
        processed_file: staging_path,
        processed_format: "webp",
        processed_bytes: processed.length,
        processed_width: processed_meta.width ?? null,
        processed_height: processed_meta.height ?? null,
        processed_checksum_sha256: sha256(processed),
        processing_ok: true,
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
      const err = e instanceof Error ? e.message : String(e);
      plan.skipped.push({ sku, reason: err });
      plan.errors.push({ sku, error: err });
    }
  }

  const out = path.join(staging_dir, "apply-plan.json");
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify(
      {
        plan_path: out,
        staging_dir,
        approved_rows: approved.length,
        prepared: plan.items.length,
        skipped: plan.skipped.length,
        errors: plan.errors,
        items: plan.items.map((i) => ({
          sku: i.tinda_sku,
          original_format: i.original_format,
          original_bytes: i.original_bytes,
          processed_format: i.processed_format,
          processed_bytes: i.processed_bytes,
          width: i.processed_width,
          height: i.processed_height,
          checksum: i.processed_checksum_sha256,
          processing_ok: i.processing_ok,
          processed_file: i.processed_file,
        })),
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
