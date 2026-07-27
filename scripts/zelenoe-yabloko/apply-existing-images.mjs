#!/usr/bin/env node
/**
 * Safely apply staged WebP images to existing products (image_url only).
 *
 * Usage (inside app container or with DATABASE_URL):
 *   node apply-existing-images.mjs --plan <plan.json> --staging <dir> --dry-run
 *   node apply-existing-images.mjs --plan <plan.json> --staging <dir> --apply \
 *     --report-json <path> --report-txt <path>
 *
 * Production constraint: updates only image_url for planned product_ids.
 * Does not import new products, delete old CDN URLs, or change prices/status.
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return null;
}
function has_flag(name) {
  return process.argv.includes(`--${name}`);
}

const PLAN_PATH =
  arg("plan") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-images/existing-image-update-plan.json",
  );
const STAGING_DIR =
  arg("staging") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-images/staging-existing",
  );
const DRY_RUN = has_flag("dry-run") || !has_flag("apply");
const APPLY = has_flag("apply");
const REPORT_JSON =
  arg("report-json") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-images/existing-image-apply-report.json",
  );
const REPORT_TXT = arg("report-txt") || null;
const PLAN_OUT = arg("plan-out") || PLAN_PATH;
const BACKUP_PATH = arg("backup") || null;
const UPLOADS_ROOT =
  process.env.PRODUCT_IMAGES_UPLOADS_ROOT ||
  path.join(process.cwd(), "public", "uploads");

const prisma = new PrismaClient();

function now_iso() {
  return new Date().toISOString();
}

function is_webp_buffer(buf) {
  if (!buf || buf.length < 12) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function resolve_staged_path(item) {
  const base = path.basename(item.staged_webp_path || "");
  const candidates = [
    item.staged_webp_path,
    path.join(STAGING_DIR, base),
    path.join(STAGING_DIR, `${item.sku}.staged.webp`),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.resolve(p);
  }
  return path.resolve(STAGING_DIR, base || `${item.sku}.staged.webp`);
}

function build_public_url(storage_key) {
  return `/uploads/${storage_key.split(path.sep).join("/")}`;
}

async function put_local(storage_key, body) {
  const absolute = path.join(UPLOADS_ROOT, storage_key);
  const normalized_root = path.resolve(UPLOADS_ROOT);
  const normalized_target = path.resolve(absolute);
  if (
    normalized_target !== normalized_root &&
    !normalized_target.startsWith(normalized_root + path.sep)
  ) {
    throw new Error(`Unsafe storage path: ${storage_key}`);
  }
  fs.mkdirSync(path.dirname(normalized_target), { recursive: true });
  fs.writeFileSync(normalized_target, body);
  return normalized_target;
}

async function load_plan() {
  const raw = fs.readFileSync(PLAN_PATH, "utf8");
  return JSON.parse(raw);
}

async function fetch_product(product_id) {
  return prisma.products.findUnique({
    where: { id: product_id },
    select: {
      id: true,
      sku: true,
      name: true,
      image_url: true,
      is_active: true,
      price_amount: true,
      price_currency: true,
      sales_status: true,
      availability: true,
      package_type: true,
      volume_text: true,
      units_per_package: true,
      updated_at: true,
    },
  });
}

function validate_item(item, product, file_meta, seen_targets) {
  const errors = [];

  if (!product) {
    errors.push("product_id_not_found");
  } else {
    if (product.sku !== item.sku) {
      errors.push(`sku_mismatch:db=${product.sku}:plan=${item.sku}`);
    }
    if (!product.is_active) {
      errors.push("product_inactive");
    }
    const db_url = product.image_url || null;
    const plan_old = item.old_image_url || null;
    if (db_url !== plan_old) {
      errors.push(
        `old_image_url_mismatch:db=${JSON.stringify(db_url)}:plan=${JSON.stringify(plan_old)}`,
      );
    }
  }

  if (item.apply_status !== "pending") {
    errors.push(`apply_status_not_pending:${item.apply_status}`);
  }

  if (!file_meta.exists) {
    errors.push("staged_webp_missing");
  } else {
    if (!file_meta.readable) errors.push("staged_webp_unreadable");
    if (file_meta.size <= 0) errors.push("staged_webp_empty");
    if (file_meta.mime !== "image/webp") {
      errors.push(`mime_not_webp:${file_meta.mime}`);
    }
    if (file_meta.sha256 !== item.sha256) {
      errors.push(
        `sha256_mismatch:file=${file_meta.sha256}:plan=${item.sha256}`,
      );
    }
  }

  const target = item.upload_target_path;
  if (!target || !/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(target)) {
    errors.push("upload_target_path_invalid");
  } else if (seen_targets.has(target)) {
    errors.push("upload_target_path_duplicate");
  } else {
    seen_targets.add(target);
  }

  if (!target.startsWith(`products/${item.product_id}/`)) {
    errors.push("upload_target_product_id_mismatch");
  }

  return errors;
}

function read_file_meta(staged_path) {
  const meta = {
    path: staged_path,
    exists: false,
    readable: false,
    size: 0,
    mime: null,
    sha256: null,
    buffer: null,
  };
  if (!fs.existsSync(staged_path)) return meta;
  meta.exists = true;
  try {
    const buf = fs.readFileSync(staged_path);
    meta.readable = true;
    meta.size = buf.length;
    meta.buffer = buf;
    meta.sha256 = sha256(buf);
    meta.mime = is_webp_buffer(buf) ? "image/webp" : "unknown";
  } catch {
    meta.readable = false;
  }
  return meta;
}

async function snapshot_orders() {
  const [orders, order_items] = await Promise.all([
    prisma.orders.count(),
    prisma.order_items.count(),
  ]);
  return { orders, order_items };
}

async function snapshot_prices(product_ids) {
  const rows = await prisma.products.findMany({
    where: { id: { in: product_ids } },
    select: {
      id: true,
      sku: true,
      price_amount: true,
      sales_status: true,
      availability: true,
      name: true,
      is_active: true,
      package_type: true,
    },
    orderBy: { sku: "asc" },
  });
  return rows.map((r) => ({
    ...r,
    price_amount:
      r.price_amount === null || r.price_amount === undefined
        ? null
        : String(r.price_amount),
  }));
}

async function main() {
  if (APPLY && DRY_RUN && has_flag("dry-run")) {
    // explicit dry-run wins when both present? Prefer: --apply alone applies.
  }
  const mode = APPLY && !has_flag("dry-run") ? "apply" : "dry-run";

  const plan = await load_plan();
  const items = Array.isArray(plan.items) ? plan.items : [];
  if (items.length !== 9) {
    console.error(`Expected 9 plan items, got ${items.length}`);
  }

  const product_ids = items.map((i) => i.product_id);
  const prices_before = await snapshot_prices(product_ids);
  const orders_before = await snapshot_orders();

  const seen_targets = new Set();
  const results = [];
  let uploaded = 0;
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const staged_path = resolve_staged_path(item);
    const file_meta = read_file_meta(staged_path);
    const product = await fetch_product(item.product_id);
    const validation_errors = validate_item(
      item,
      product,
      file_meta,
      seen_targets,
    );

    const entry = {
      product_id: item.product_id,
      sku: item.sku,
      product_name: item.product_name,
      apply_status: "pending",
      applied_at: null,
      old_image_url: item.old_image_url,
      new_image_url: null,
      upload_target_path: item.upload_target_path,
      upload_result: null,
      error_message: null,
      validation_errors,
      db_before: product
        ? {
            sku: product.sku,
            image_url: product.image_url,
            is_active: product.is_active,
            price_amount:
              product.price_amount == null
                ? null
                : String(product.price_amount),
            sales_status: product.sales_status,
            availability: product.availability,
            package_type: product.package_type,
            name: product.name,
          }
        : null,
      staged_webp_path: staged_path,
      file_size: file_meta.size,
      sha256: file_meta.sha256,
    };

    if (validation_errors.length) {
      entry.apply_status = "skipped";
      entry.error_message = validation_errors.join("; ");
      skipped += 1;
      results.push(entry);
      continue;
    }

    if (mode === "dry-run") {
      entry.apply_status = "pending";
      entry.upload_result = "dry_run_ok";
      results.push(entry);
      continue;
    }

    // APPLY
    const storage_key = item.upload_target_path;
    try {
      const abs = await put_local(storage_key, file_meta.buffer);
      const written = fs.readFileSync(abs);
      if (sha256(written) !== item.sha256) {
        throw new Error("post_write_sha256_mismatch");
      }
      if (!is_webp_buffer(written)) {
        throw new Error("post_write_not_webp");
      }
      uploaded += 1;
      entry.upload_result = "uploaded";
      entry.new_image_url = build_public_url(storage_key);

      // Update ONLY image_url after successful upload
      const updated = await prisma.products.updateMany({
        where: {
          id: item.product_id,
          sku: item.sku,
          is_active: true,
          image_url: item.old_image_url,
        },
        data: {
          image_url: entry.new_image_url,
          updated_at: new Date(),
        },
      });

      if (updated.count !== 1) {
        entry.apply_status = "failed";
        entry.error_message = `db_update_count=${updated.count}; image_url left unchanged`;
        entry.upload_result = "uploaded_but_db_not_updated";
        // Leave orphaned file in storage; do not flip image_url.
        failed += 1;
        results.push(entry);
        continue;
      }

      entry.apply_status = "applied";
      entry.applied_at = now_iso();
      applied += 1;
      results.push(entry);
    } catch (err) {
      entry.apply_status = "failed";
      entry.error_message = err?.message || String(err);
      entry.upload_result = entry.upload_result || "upload_failed";
      entry.new_image_url = null;
      failed += 1;
      results.push(entry);
    }
  }

  const prices_after = await snapshot_prices(product_ids);
  const orders_after = await snapshot_orders();

  // Price / status drift check
  const drift = [];
  for (const before of prices_before) {
    const after = prices_after.find((p) => p.id === before.id);
    if (!after) {
      drift.push({ sku: before.sku, issue: "missing_after" });
      continue;
    }
    for (const field of [
      "price_amount",
      "sales_status",
      "availability",
      "name",
      "is_active",
      "package_type",
      "sku",
    ]) {
      if (String(before[field]) !== String(after[field])) {
        drift.push({
          sku: before.sku,
          field,
          before: before[field],
          after: after[field],
        });
      }
    }
  }

  // Update plan file statuses when applying (or write dry-run annotations)
  let plan_write_error = null;
  if (mode === "apply") {
    const by_id = new Map(results.map((r) => [r.product_id, r]));
    plan.items = plan.items.map((item) => {
      const r = by_id.get(item.product_id);
      if (!r) return item;
      return {
        ...item,
        apply_status: r.apply_status,
        applied_at: r.applied_at,
        old_image_url: r.old_image_url,
        new_image_url: r.new_image_url,
        upload_result: r.upload_result,
        error_message: r.error_message,
        validation_errors: r.validation_errors,
      };
    });
    plan.applied_at = now_iso();
    plan.apply_mode = "apply";
    plan.note =
      "Applied to production: only image_url updated for listed products. Old external URLs not deleted.";
    try {
      fs.mkdirSync(path.dirname(PLAN_OUT), { recursive: true });
      fs.writeFileSync(PLAN_OUT, JSON.stringify(plan, null, 2) + "\n");
    } catch (err) {
      plan_write_error = err?.message || String(err);
      console.error("plan_write_failed:", plan_write_error);
    }
  }

  const report = {
    generated_at: now_iso(),
    mode,
    backup_path: BACKUP_PATH,
    plan_path: PLAN_PATH,
    staging_dir: STAGING_DIR,
    uploads_root: UPLOADS_ROOT,
    counts: {
      planned: items.length,
      dry_run_ok:
        mode === "dry-run"
          ? results.filter((r) => r.validation_errors.length === 0).length
          : null,
      dry_run_failed:
        mode === "dry-run"
          ? results.filter((r) => r.validation_errors.length > 0).length
          : null,
      uploaded: mode === "apply" ? uploaded : 0,
      applied,
      skipped,
      failed,
    },
    orders_before,
    orders_after,
    orders_unchanged:
      orders_before.orders === orders_after.orders &&
      orders_before.order_items === orders_after.order_items,
    field_drift: drift,
    plan_out: PLAN_OUT,
    plan_write_error,
    items: results,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");

  const lines = [];
  lines.push(`TINDA Zelenoe existing images apply report`);
  lines.push(`generated_at: ${report.generated_at}`);
  lines.push(`mode: ${mode}`);
  lines.push(`backup: ${BACKUP_PATH || "(not set)"}`);
  lines.push(`uploads_root: ${UPLOADS_ROOT}`);
  lines.push(`planned: ${items.length}`);
  if (mode === "dry-run") {
    lines.push(`dry_run_ok: ${report.counts.dry_run_ok}`);
    lines.push(`dry_run_failed: ${report.counts.dry_run_failed}`);
  } else {
    lines.push(`uploaded: ${uploaded}`);
    lines.push(`applied: ${applied}`);
    lines.push(`skipped: ${skipped}`);
    lines.push(`failed: ${failed}`);
  }
  lines.push(
    `orders: ${orders_before.orders} -> ${orders_after.orders} (items ${orders_before.order_items} -> ${orders_after.order_items}) unchanged=${report.orders_unchanged}`,
  );
  lines.push(`field_drift_count: ${drift.length}`);
  lines.push("");
  lines.push("SKU | status | old_image_url | new_image_url | error");
  for (const r of results) {
    lines.push(
      `${r.sku} | ${r.apply_status} | ${r.old_image_url} | ${r.new_image_url || "-"} | ${r.error_message || "-"}`,
    );
  }
  const txt = lines.join("\n") + "\n";
  if (REPORT_TXT) {
    fs.mkdirSync(path.dirname(REPORT_TXT), { recursive: true });
    fs.writeFileSync(REPORT_TXT, txt);
  }

  console.log(txt);
  console.log(`report_json: ${REPORT_JSON}`);
  if (REPORT_TXT) console.log(`report_txt: ${REPORT_TXT}`);

  if (mode === "dry-run" && report.counts.dry_run_failed > 0) {
    process.exitCode = 2;
  }
  if (mode === "apply" && failed > 0) {
    process.exitCode = 3;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
