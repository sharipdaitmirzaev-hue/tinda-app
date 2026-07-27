#!/usr/bin/env node
/**
 * Import approved_new Zelenoe JUICE / NECTAR / MORS products (create-only).
 *
 *   node import-juice-products.mjs --source <json> --preview
 *   node import-juice-products.mjs --source <json> --apply \
 *     --report-json ... --report-txt ... --backup ...
 *
 * Only creates new products. Never updates existing rows.
 * Images → /uploads/products/{product_id}/{uuid}.webp
 * package_requires_review has no DB column — recorded in report only.
 *
 * Categories (existing only): juice→sok, nectar→nektar, mors→mors.
 * juice_drink / missing category → skip with category_missing (do not create).
 */

import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_SIDE = 1600;
const PRODUCT_IMAGE_WEBP_QUALITY = 82;
const PRODUCT_IMAGE_MIN_SIDE = 500;
const EXPECTED = 50;
const REQUIRED_CATEGORIES = ["sok", "nektar", "mors"];
const PRODUCT_TYPE_TO_CATEGORY = {
  juice: "sok",
  nectar: "nektar",
  mors: "mors",
};

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
    "../../data/imports/zelenoe-yabloko-juice/approved-new-import-batch.json",
  );
const MODE = has_flag("apply") && !has_flag("preview") ? "apply" : "preview";
const REPORT_JSON =
  arg("report-json") ||
  path.resolve(
    __dirname,
    "../../data/imports/zelenoe-yabloko-juice/approved-apply-report.json",
  );
const REPORT_TXT = arg("report-txt") || null;
const BACKUP = arg("backup") || null;
const UPLOADS_ROOT =
  process.env.PRODUCT_IMAGES_UPLOADS_ROOT ||
  path.join(process.cwd(), "public", "uploads");

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

function normalize_package(pkg) {
  const t = String(pkg || "").toLowerCase();
  if (/(ж\s*\/\s*б|банка|can|жест|алюм)/.test(t)) return "can";
  if (/(пэт|pet|пл\s*\/\s*б|п\s*\/\s*бут)/.test(t)) return "pet";
  if (/(стекл|ст\s*\/\s*б|glass)/.test(t)) return "glass";
  if (/(тетра|tetra|пюр-пак|пюрпак)/.test(t)) return "tetra";
  return t || "";
}

function load_rows() {
  const abs = path.resolve(SOURCE);
  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  const items = Array.isArray(data) ? data : data.items;
  return items.map((r, i) => normalize_row(r, i + 2));
}

function normalize_row(r, row_number) {
  const local =
    r.local_image_path ||
    r.local_original_path ||
    r.image_path ||
    null;
  const package_type =
    r.package_type == null ? "" : String(r.package_type).trim();
  const product_type = String(r.product_type || "").trim();
  let category_slug = String(r.category_slug || "").trim();
  if (!category_slug && PRODUCT_TYPE_TO_CATEGORY[product_type]) {
    category_slug = PRODUCT_TYPE_TO_CATEGORY[product_type];
  }
  const category_missing =
    r.category_missing === true ||
    !category_slug ||
    !PRODUCT_TYPE_TO_CATEGORY[product_type];

  return {
    row: row_number,
    source_index: r.source_index ?? null,
    source_name: String(r.source_name || "").trim(),
    brand: r.brand == null ? null : String(r.brand).trim(),
    flavor: r.flavor == null ? "" : String(r.flavor).trim(),
    volume_text: r.volume_text == null ? null : String(r.volume_text).trim(),
    volume_ml: r.volume_ml == null ? null : Number(r.volume_ml),
    package_type: package_type || null,
    package_norm: normalize_package(package_type),
    product_type: product_type || null,
    is_kids_line: !!r.is_kids_line,
    source_product_url: r.source_product_url
      ? String(r.source_product_url).trim()
      : null,
    local_image_path: local ? String(local).trim() : null,
    proposed_sku: String(r.proposed_sku || "").trim(),
    category_slug: category_missing ? "" : category_slug,
    category_missing,
    units_per_package: 1,
    package_requires_review: true,
    expected_sha256: r.sha256 ? String(r.sha256) : null,
    expected_width: r.width == null ? null : Number(r.width),
    expected_height: r.height == null ? null : Number(r.height),
  };
}

function resolve_image_path(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return path.resolve(p);
  const base = path.basename(p);
  const candidates = [
    path.join("/app/tmp/zelenoe-juice/original", base),
    path.join(path.dirname(SOURCE), "original", base),
    path.resolve("data/imports/zelenoe-yabloko-juice/original", base),
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

async function load_category_structure() {
  const cats = await prisma.categories.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      is_active: true,
      parent_id: true,
    },
    orderBy: { slug: "asc" },
  });
  const juiceish = cats.filter(
    (c) =>
      /sok|nektar|mors|juice/i.test(c.slug) ||
      /сок|нектар|морс|сокосодерж|детск/i.test(c.name || ""),
  );
  return { all: cats, juiceish };
}

function count_by(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] || "(empty)";
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function main() {
  const rows = load_rows();
  const before = await snapshot_guard();
  const category_structure = await load_category_structure();
  const cat_by_slug = new Map(
    category_structure.all.map((c) => [c.slug, c]),
  );

  const missing_required = REQUIRED_CATEGORIES.filter(
    (s) => !cat_by_slug.has(s),
  );
  if (missing_required.length) {
    console.error(
      "STOP: required juice categories missing. Do not create categories automatically.",
    );
    console.error(
      JSON.stringify(
        {
          missing_required,
          juiceish_categories: category_structure.juiceish,
          all_slugs: category_structure.all.map((c) => c.slug),
        },
        null,
        2,
      ),
    );
    const stop_report = {
      generated_at: now_iso(),
      mode: "preview_stopped",
      reason: "juice_categories_missing",
      missing_required,
      backup_path: BACKUP,
      category_structure: category_structure.juiceish,
      before,
    };
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(stop_report, null, 2) + "\n");
    process.exit(4);
  }

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
  let category_missing_count = 0;

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
    let width = null;
    let height = null;

    if (row.category_missing) {
      category_missing_count += 1;
      errors.push("category_missing");
    }

    if (!row.proposed_sku) errors.push("proposed_sku_missing");
    if (!row.source_name) errors.push("source_name_missing");
    if (!row.brand) errors.push("brand_missing");
    if (!row.flavor) errors.push("flavor_missing");
    if (!row.volume_text) errors.push("volume_text_missing");
    if (!row.package_type) errors.push("package_type_missing");
    else if (!row.package_norm) errors.push("package_type_unknown");
    if (!row.product_type) errors.push("product_type_missing");
    if (!row.category_missing && !row.category_slug) {
      errors.push("category_slug_missing");
    }
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

    const cat = row.category_slug ? cat_by_slug.get(row.category_slug) : null;
    if (!row.category_missing) {
      if (!cat) errors.push("category_slug_not_found");
      else if (!cat.is_active) errors.push("category_inactive");
    }

    if (!img_path || !fs.existsSync(img_path)) {
      errors.push("local_image_missing");
    } else {
      try {
        const buf = fs.readFileSync(img_path);
        readable = true;
        size = buf.length;
        mime = detect_mime(buf);
        file_sha = sha256(buf);
        const meta = await sharp(buf, { failOn: "error" }).metadata();
        width = meta.width || null;
        height = meta.height || null;
        if (size <= 0) errors.push("image_empty");
        if (!mime) errors.push("mime_not_allowed");
        else if (!["image/webp", "image/jpeg", "image/png"].includes(mime)) {
          errors.push(`mime_not_allowed:${mime}`);
        }
        if (size > PRODUCT_IMAGE_MAX_BYTES) errors.push("image_too_large");
        if (
          !width ||
          !height ||
          width < PRODUCT_IMAGE_MIN_SIDE ||
          height < PRODUCT_IMAGE_MIN_SIDE
        ) {
          errors.push(`image_below_500:${width}x${height}`);
        }
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
      image_width: width,
      image_height: height,
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
  const package_requires_review_skus = preview_items
    .filter((i) => i.proposed_sku)
    .map((i) => i.proposed_sku);
  const category_missing_items = preview_items.filter((i) =>
    (i.validation_errors || []).includes("category_missing"),
  );

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
            brand: true,
            image_url: true,
            sales_status: true,
            price_amount: true,
            availability: true,
            units_per_package: true,
            is_active: true,
            category_id: true,
            volume_text: true,
            package_type: true,
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

  const created_results = results.filter((r) => r.apply_status === "created");
  const preview_ok_results = results.filter(
    (r) => r.apply_status === "preview_ok" || r.apply_status === "created",
  );
  const local_image_urls =
    created_results.length === 0
      ? null
      : created_results.every(
          (r) =>
            typeof r.image_url === "string" &&
            r.image_url.startsWith("/uploads/products/") &&
            r.image_url.endsWith(".webp"),
        );

  const report = {
    generated_at: now_iso(),
    mode: MODE,
    backup_path: BACKUP,
    source: path.resolve(SOURCE),
    uploads_root: UPLOADS_ROOT,
    expected_rows: EXPECTED,
    row_count: rows.length,
    note:
      "Create-only import of approved_new Zelenoe JUICE/NECTAR/MORS. No schema change. package_requires_review has no DB column — SKU list recorded below. juice_drink skipped as category_missing.",
    package_requires_review: true,
    package_requires_review_detail: {
      field_in_schema: false,
      flag_value: true,
      skus: package_requires_review_skus,
      count: package_requires_review_skus.length,
      note: "Transport packaging (units_per_package) requires clarification; units_per_package forced to 1.",
    },
    category_mapping: PRODUCT_TYPE_TO_CATEGORY,
    category_structure: {
      sok: cat_by_slug.get("sok") || null,
      nektar: cat_by_slug.get("nektar") || null,
      mors: cat_by_slug.get("mors") || null,
      juiceish: category_structure.juiceish,
    },
    product_type_distribution: count_by(rows, "product_type"),
    category_distribution_selected: count_by(
      rows.filter((r) => !r.category_missing),
      "category_slug",
    ),
    category_missing: {
      count: category_missing_count,
      items: category_missing_items.map((i) => ({
        proposed_sku: i.proposed_sku,
        product_type: i.product_type,
        is_kids_line: i.is_kids_line,
        source_name: i.source_name,
        reason: "category_missing",
      })),
    },
    preview_checks: {
      candidate_count: rows.length,
      expected: EXPECTED,
      unique_proposed_sku: seen_sku.size,
      batch_internal_sku_dupes: rows.length - seen_sku.size,
      product_type_defined: rows.every((r) => !!r.product_type),
      flavor_defined: rows.every((r) => !!r.flavor),
      volume_text_defined: rows.every((r) => !!r.volume_text),
      package_type_defined: rows.every((r) => !!r.package_type),
      preview_ok,
      preview_failed,
      category_missing: category_missing_count,
      all_images_readable: preview_items.every(
        (i) => i.category_missing || i.image_readable,
      ),
      all_mime_allowed: preview_items.every(
        (i) =>
          !i.preview_ok ||
          ["image/webp", "image/jpeg", "image/png"].includes(i.image_mime),
      ),
      all_ge_500: preview_items.every(
        (i) =>
          !i.preview_ok ||
          (i.image_width >= PRODUCT_IMAGE_MIN_SIDE &&
            i.image_height >= PRODUCT_IMAGE_MIN_SIDE),
      ),
    },
    counts: {
      preview_ok: MODE === "preview" ? preview_ok : null,
      preview_failed: MODE === "preview" ? preview_failed : null,
      created: MODE === "apply" ? created : 0,
      skipped: MODE === "apply" ? skipped : preview_failed,
      failed: MODE === "apply" ? failed : 0,
      images_uploaded: MODE === "apply" ? images_uploaded : 0,
      category_missing: category_missing_count,
    },
    created_by_product_type:
      MODE === "apply" ? count_by(created_results, "product_type") : null,
    created_by_category:
      MODE === "apply" ? count_by(created_results, "category_slug") : null,
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
      all_new_image_urls_local: MODE === "apply" ? local_image_urls : null,
    },
    created_skus: created_results.map((r) => r.proposed_sku),
    preview_ok_skus: preview_ok_results.map((r) => r.proposed_sku),
    items: results,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");

  const lines = [];
  lines.push("TINDA Zelenoe JUICE/NECTAR/MORS approved_new import report");
  lines.push(`generated_at: ${report.generated_at}`);
  lines.push(`mode: ${MODE}`);
  lines.push(`backup: ${BACKUP || "(not set)"}`);
  lines.push(`source: ${report.source}`);
  lines.push(`rows: ${rows.length} (expected ${EXPECTED})`);
  lines.push(
    `categories present: sok=${!!cat_by_slug.get("sok")}, nektar=${!!cat_by_slug.get("nektar")}, mors=${!!cat_by_slug.get("mors")}`,
  );
  lines.push(
    `product_type: ${JSON.stringify(report.product_type_distribution)}`,
  );
  lines.push(
    `category_missing: ${category_missing_count} (${category_missing_items.map((i) => i.proposed_sku).join(", ")})`,
  );
  lines.push(`package_requires_review: true`);
  if (MODE === "preview") {
    lines.push(`preview_ok: ${preview_ok}`);
    lines.push(`preview_failed: ${preview_failed}`);
  } else {
    lines.push(`created: ${created}`);
    lines.push(`skipped: ${skipped}`);
    lines.push(`failed: ${failed}`);
    lines.push(`images_uploaded: ${images_uploaded}`);
    lines.push(
      `created_by_product_type: ${JSON.stringify(report.created_by_product_type)}`,
    );
    lines.push(
      `created_by_category: ${JSON.stringify(report.created_by_category)}`,
    );
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
  lines.push(
    "SKU | status | product_type | category | product_id | image_url | error",
  );
  for (const r of results) {
    lines.push(
      `${r.proposed_sku} | ${r.apply_status} | ${r.product_type} | ${r.category_slug || "-"} | ${r.product_id || "-"} | ${r.image_url || "-"} | ${r.error_message || "-"}`,
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

  const unexpected_failures =
    preview_failed - category_missing_count > 0 || rows.length !== EXPECTED;
  if (MODE === "preview" && unexpected_failures) {
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
