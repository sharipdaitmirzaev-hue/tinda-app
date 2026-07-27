#!/usr/bin/env node
/**
 * Import 26 approved_new Zelenoe products (create-only).
 *
 *   node import-new-products.mjs --source <json|xlsx> --preview
 *   node import-new-products.mjs --source <json> --apply \
 *     --report-json ... --report-txt ... --backup ...
 *
 * Only creates new products. Never updates existing rows.
 * Images go through local product-images storage:
 *   /uploads/products/{product_id}/{uuid}.webp
 */

import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_SIDE = 1600;
const PRODUCT_IMAGE_WEBP_QUALITY = 82;

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

const SOURCE =
  arg("source") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-images/approved-new-products.json",
  );
const MODE = has_flag("apply") && !has_flag("preview") ? "apply" : "preview";
const REPORT_JSON =
  arg("report-json") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-images/new-products-apply-report.json",
  );
const REPORT_TXT = arg("report-txt") || null;
const BACKUP = arg("backup") || null;
const UPLOADS_ROOT =
  process.env.PRODUCT_IMAGES_UPLOADS_ROOT ||
  path.join(process.cwd(), "public", "uploads");
const EXPECTED = 26;

function now_iso() {
  return new Date().toISOString();
}

function is_webp(buf) {
  return (
    buf?.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}
function is_jpeg(buf) {
  return buf?.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
function is_png(buf) {
  return (
    buf?.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}
function detect_mime(buf) {
  if (is_webp(buf)) return "image/webp";
  if (is_jpeg(buf)) return "image/jpeg";
  if (is_png(buf)) return "image/png";
  return null;
}
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function load_rows() {
  const abs = path.resolve(SOURCE);
  if (abs.endsWith(".json")) {
    const data = JSON.parse(fs.readFileSync(abs, "utf8"));
    const items = Array.isArray(data) ? data : data.items;
    return items.map((r, i) => normalize_row(r, i + 2));
  }
  if (abs.endsWith(".xlsx") || abs.endsWith(".xls")) {
    const XLSX = require("xlsx");
    const wb = XLSX.readFile(abs);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return rows.map((r, i) => normalize_row(r, i + 2));
  }
  throw new Error(`Unsupported source: ${abs}`);
}

function normalize_row(r, row_number) {
  const local =
    r.local_image_path ||
    r.local_original_path ||
    r.image_path ||
    null;
  return {
    row: row_number,
    source_index: r.source_index ?? null,
    source_name: String(r.source_name || "").trim(),
    brand: r.brand == null ? null : String(r.brand).trim(),
    flavor: r.flavor == null ? null : String(r.flavor).trim(),
    volume_text: r.volume_text == null ? null : String(r.volume_text).trim(),
    package_type: r.package_type == null ? null : String(r.package_type).trim(),
    source_product_url: r.source_product_url
      ? String(r.source_product_url).trim()
      : null,
    local_image_path: local ? String(local).trim() : null,
    proposed_sku: String(r.proposed_sku || "").trim(),
    category_slug: String(r.category_slug || "").trim(),
    units_per_package: Number(r.units_per_package ?? 1),
    package_requires_review: r.package_requires_review !== false,
    expected_sha256: r.sha256 ? String(r.sha256) : null,
  };
}

function resolve_image_path(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return path.resolve(p);
  // remap /workspace/... when files copied under /app/tmp/...
  const base = path.basename(p);
  const candidates = [
    path.join("/app/tmp/zelenoe-new/original", base),
    path.join(path.dirname(SOURCE), "original", base),
    path.resolve("data/imports/zelenoe-yabloko-images/original", base),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(p);
}

async function process_webp(buffer) {
  if (!buffer || buffer.length === 0) throw new Error("empty_image");
  if (buffer.length > PRODUCT_IMAGE_MAX_BYTES) throw new Error("image_too_large");
  const mime = detect_mime(buffer);
  if (!mime) throw new Error("unsupported_image_mime");
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({
      width: PRODUCT_IMAGE_MAX_SIDE,
      height: PRODUCT_IMAGE_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY })
    .toBuffer();
}

function put_local(storage_key, body) {
  const absolute = path.join(UPLOADS_ROOT, storage_key);
  const root = path.resolve(UPLOADS_ROOT);
  const target = path.resolve(absolute);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("unsafe_storage_path");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

function public_url(storage_key) {
  return `/uploads/${storage_key.split(path.sep).join("/")}`;
}

async function snapshot_guard() {
  const [
    products_total,
    showcase_active,
    orderable_active,
    no_price,
    orders,
    order_items,
    clients,
    interest,
    orderable_priced,
  ] = await Promise.all([
    prisma.products.count(),
    prisma.products.count({
      where: { is_active: true, sales_status: "showcase" },
    }),
    prisma.products.count({
      where: { is_active: true, sales_status: "orderable" },
    }),
    prisma.products.count({
      where: { is_active: true, price_amount: null },
    }),
    prisma.orders.count(),
    prisma.order_items.count(),
    prisma.clients.count(),
    prisma.product_interest_requests.count(),
    prisma.products.findMany({
      where: { is_active: true, sales_status: "orderable" },
      select: { sku: true, price_amount: true },
      orderBy: { sku: "asc" },
    }),
  ]);
  return {
    products_total,
    showcase_active,
    orderable_active,
    no_price,
    orders,
    order_items,
    clients,
    interest,
    orderable_priced: orderable_priced.map((p) => ({
      sku: p.sku,
      price_amount: p.price_amount == null ? null : String(p.price_amount),
    })),
  };
}

async function main() {
  const rows = load_rows();
  const before = await snapshot_guard();

  const categories = await prisma.categories.findMany({
    select: { id: true, slug: true, is_active: true },
  });
  const cat_by_slug = new Map(categories.map((c) => [c.slug, c]));

  const existing_skus = new Set(
    (
      await prisma.products.findMany({
        select: { sku: true },
      })
    ).map((p) => p.sku),
  );

  const existing_exact = new Set(
    (
      await prisma.products.findMany({
        select: {
          name: true,
          brand: true,
          volume_text: true,
          package_type: true,
        },
      })
    ).map((p) =>
      [p.name, p.brand, p.volume_text, p.package_type]
        .map((x) => String(x || "").toLowerCase())
        .join("|"),
    ),
  );

  const preview_items = [];
  const seen_sku = new Map();
  const seen_exact = new Map();
  let preview_ok = 0;
  let preview_failed = 0;

  if (rows.length !== EXPECTED) {
    console.error(`Expected ${EXPECTED} rows, got ${rows.length}`);
  }

  for (const row of rows) {
    const errors = [];
    const img_path = resolve_image_path(row.local_image_path);
    let mime = null;
    let size = 0;
    let file_sha = null;
    let readable = false;

    if (!row.proposed_sku) errors.push("proposed_sku_missing");
    if (!row.source_name) errors.push("source_name_missing");
    if (!row.brand) errors.push("brand_missing");
    if (!row.volume_text) errors.push("volume_text_missing");
    if (!row.package_type) errors.push("package_type_missing");
    if (!row.category_slug) errors.push("category_slug_missing");
    if (!row.local_image_path) errors.push("local_image_path_missing");

    if (row.proposed_sku) {
      if (seen_sku.has(row.proposed_sku)) {
        errors.push(`duplicate_sku_in_file:${seen_sku.get(row.proposed_sku)}`);
      } else {
        seen_sku.set(row.proposed_sku, row.row);
      }
      if (existing_skus.has(row.proposed_sku)) {
        errors.push("sku_exists_in_tinda");
      }
    }

    const exact = [row.source_name, row.brand, row.volume_text, row.package_type]
      .map((x) => String(x || "").toLowerCase())
      .join("|");
    if (seen_exact.has(exact)) {
      errors.push(`duplicate_exact_in_file:${seen_exact.get(exact)}`);
    } else {
      seen_exact.set(exact, row.row);
    }
    if (existing_exact.has(exact)) {
      errors.push("exact_duplicate_exists_in_tinda");
    }

    const cat = cat_by_slug.get(row.category_slug);
    if (!cat) errors.push("category_slug_not_found");
    else if (!cat.is_active) errors.push("category_inactive");

    if (!img_path || !fs.existsSync(img_path)) {
      errors.push("local_image_missing");
    } else {
      try {
        const buf = fs.readFileSync(img_path);
        readable = true;
        size = buf.length;
        mime = detect_mime(buf);
        file_sha = sha256(buf);
        if (size <= 0) errors.push("image_empty");
        if (!mime) errors.push("mime_not_allowed");
        else if (!["image/webp", "image/jpeg", "image/png"].includes(mime)) {
          errors.push(`mime_not_allowed:${mime}`);
        }
        if (size > PRODUCT_IMAGE_MAX_BYTES) errors.push("image_too_large");
      } catch {
        errors.push("image_unreadable");
      }
    }

    const item = {
      ...row,
      resolved_image_path: img_path,
      image_readable: readable,
      image_mime: mime,
      image_size: size,
      image_sha256: file_sha,
      category_id: cat?.id || null,
      preview_ok: errors.length === 0,
      validation_errors: errors,
      apply_status: "pending",
      product_id: null,
      image_url: null,
      upload_result: null,
      error_message: null,
      created_at: null,
    };

    if (errors.length) {
      preview_failed += 1;
      item.apply_status = "skipped";
      item.error_message = errors.join("; ");
    } else {
      preview_ok += 1;
    }
    preview_items.push(item);
  }

  const results = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let images_uploaded = 0;
  const package_requires_review_skus = [];

  for (const item of preview_items) {
    if (item.proposed_sku) package_requires_review_skus.push(item.proposed_sku);
  }

  if (MODE === "preview") {
    for (const item of preview_items) {
      if (!item.preview_ok) skipped += 1;
      results.push({
        ...item,
        apply_status: item.preview_ok ? "preview_ok" : "skipped",
      });
    }
  } else {
    for (const item of preview_items) {
      if (!item.preview_ok) {
        skipped += 1;
        results.push({
          ...item,
          apply_status: "skipped",
          error_message: item.error_message,
        });
        continue;
      }

      const product_id = randomUUID();
      const storage_key = `products/${product_id}/${randomUUID()}.webp`;
      let image_url = null;

      try {
        const raw = fs.readFileSync(item.resolved_image_path);
        const processed = await process_webp(raw);
        if (!is_webp(processed) || processed.length <= 0) {
          throw new Error("processed_not_webp");
        }
        put_local(storage_key, processed);
        const written = fs.readFileSync(path.join(UPLOADS_ROOT, storage_key));
        if (!is_webp(written)) throw new Error("post_write_not_webp");
        image_url = public_url(storage_key);
        images_uploaded += 1;
      } catch (err) {
        failed += 1;
        results.push({
          ...item,
          product_id,
          apply_status: "failed",
          upload_result: "upload_failed",
          error_message: err?.message || String(err),
          image_url: null,
        });
        continue;
      }

      try {
        const created_row = await prisma.products.create({
          data: {
            id: product_id,
            sku: item.proposed_sku,
            name: item.source_name,
            brand: item.brand,
            category_id: item.category_id,
            volume_text: item.volume_text,
            package_type: item.package_type,
            units_per_package: 1,
            sale_unit: "упаковка",
            min_order_qty: 1,
            allow_piece_sale: false,
            description: null,
            availability: "on_order",
            sales_status: "showcase",
            is_promo: false,
            is_new: true,
            is_hit: false,
            image_url,
            is_active: true,
            price_amount: null,
            price_currency: "RUB",
            updated_at: new Date(),
          },
          select: {
            id: true,
            sku: true,
            name: true,
            image_url: true,
            sales_status: true,
            price_amount: true,
            availability: true,
            units_per_package: true,
            is_active: true,
          },
        });
        created += 1;
        results.push({
          ...item,
          product_id: created_row.id,
          image_url: created_row.image_url,
          apply_status: "created",
          upload_result: "uploaded",
          created_at: now_iso(),
          db: {
            ...created_row,
            price_amount:
              created_row.price_amount == null
                ? null
                : String(created_row.price_amount),
          },
        });
      } catch (err) {
        // Product not created; leave uploaded file orphaned (safe).
        failed += 1;
        results.push({
          ...item,
          product_id,
          image_url,
          apply_status: "failed",
          upload_result: "uploaded_but_create_failed",
          error_message: err?.message || String(err),
        });
      }
    }
  }

  const after = await snapshot_guard();

  const orderable_price_drift = [];
  for (const b of before.orderable_priced) {
    const a = after.orderable_priced.find((x) => x.sku === b.sku);
    if (!a || a.price_amount !== b.price_amount) {
      orderable_price_drift.push({ sku: b.sku, before: b, after: a || null });
    }
  }

  const report = {
    generated_at: now_iso(),
    mode: MODE,
    backup_path: BACKUP,
    source: path.resolve(SOURCE),
    uploads_root: UPLOADS_ROOT,
    expected_rows: EXPECTED,
    row_count: rows.length,
    note:
      "Create-only import of approved_new Zelenoe products. No schema change. package_requires_review has no DB column — SKU list recorded below.",
    package_requires_review: {
      field_in_schema: false,
      flag_value: true,
      skus: package_requires_review_skus,
      count: package_requires_review_skus.length,
    },
    counts: {
      preview_ok: MODE === "preview" ? preview_ok : null,
      preview_failed: MODE === "preview" ? preview_failed : null,
      created: MODE === "apply" ? created : 0,
      skipped: MODE === "apply" ? skipped : preview_failed,
      failed: MODE === "apply" ? failed : 0,
      images_uploaded: MODE === "apply" ? images_uploaded : 0,
    },
    before,
    after,
    guards: {
      orders_unchanged: before.orders === after.orders,
      order_items_unchanged: before.order_items === after.order_items,
      clients_unchanged: before.clients === after.clients,
      interest_unchanged: before.interest === after.interest,
      orderable_active_unchanged:
        before.orderable_active === after.orderable_active,
      orderable_price_drift,
      products_delta: after.products_total - before.products_total,
    },
    created_skus: results
      .filter((r) => r.apply_status === "created")
      .map((r) => r.proposed_sku),
    items: results,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");

  const lines = [];
  lines.push("TINDA Zelenoe new products import report");
  lines.push(`generated_at: ${report.generated_at}`);
  lines.push(`mode: ${MODE}`);
  lines.push(`backup: ${BACKUP || "(not set)"}`);
  lines.push(`source: ${report.source}`);
  lines.push(`rows: ${rows.length} (expected ${EXPECTED})`);
  if (MODE === "preview") {
    lines.push(`preview_ok: ${preview_ok}`);
    lines.push(`preview_failed: ${preview_failed}`);
  } else {
    lines.push(`created: ${created}`);
    lines.push(`skipped: ${skipped}`);
    lines.push(`failed: ${failed}`);
    lines.push(`images_uploaded: ${images_uploaded}`);
  }
  lines.push(
    `products_total: ${before.products_total} -> ${after.products_total}`,
  );
  lines.push(
    `showcase_active: ${before.showcase_active} -> ${after.showcase_active}`,
  );
  lines.push(
    `orderable_active: ${before.orderable_active} -> ${after.orderable_active}`,
  );
  lines.push(`no_price: ${before.no_price} -> ${after.no_price}`);
  lines.push(
    `orders: ${before.orders}->${after.orders}; order_items: ${before.order_items}->${after.order_items}`,
  );
  lines.push(
    `package_requires_review SKUs (${package_requires_review_skus.length}): ${package_requires_review_skus.join(", ")}`,
  );
  lines.push("");
  lines.push("SKU | status | product_id | image_url | error");
  for (const r of results) {
    lines.push(
      `${r.proposed_sku} | ${r.apply_status} | ${r.product_id || "-"} | ${r.image_url || "-"} | ${r.error_message || "-"}`,
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

  if (MODE === "preview" && (preview_failed > 0 || rows.length !== EXPECTED)) {
    process.exitCode = 2;
  }
  if (MODE === "apply" && failed > 0) {
    process.exitCode = 3;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
