#!/usr/bin/env node
/**
 * Import 4 approved_new homepage-missing products (create-only).
 *
 *   node scripts/homepage-missing-products/import-approved.mjs --preview
 *   node scripts/homepage-missing-products/import-approved.mjs --apply \
 *     --backup /var/backups/tinda/...dump \
 *     --report-json data/imports/homepage-missing-products/apply-report.json \
 *     --report-txt /var/backups/tinda/homepage-missing-products-apply-report.txt
 *
 * Only creates new products. Never updates existing rows / prices / images / schema.
 * Images → /uploads/products/{product_id}/{uuid}.webp
 * package_requires_review recorded in report only (no DB column).
 * Categories: existing only (kola, gazirovannye-napitki, energeticheskie-napitki).
 */
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const prisma = new PrismaClient();

const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_SIDE = 1600;
const PRODUCT_IMAGE_WEBP_QUALITY = 82;
const EXPECTED = 4;
const EXPECTED_SKUS = [
  "ZY-COCACOLAZERO-330-GLASS-001",
  "ZY-SPRITE-2000-PET-001",
  "ZY-ADRENALINE-250-CAN-001",
  "ZY-ADRENALINE-449-CAN-001",
];
const ALLOWED_PACKAGES = new Set(["pet", "glass", "can"]);
const ALLOWED_CATEGORIES = new Set([
  "kola",
  "gazirovannye-napitki",
  "energeticheskie-napitki",
]);

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
  path.join(ROOT, "data/imports/homepage-missing-products/approved-new-import-batch.json");
const MODE = has_flag("apply") && !has_flag("preview") ? "apply" : "preview";
const REPORT_JSON =
  arg("report-json") ||
  path.join(ROOT, "data/imports/homepage-missing-products/apply-report.json");
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
  if (/(стекл|\bglass\b)/u.test(t)) return "glass";
  if (/(пэт|pet|пластик)/.test(t)) return "pet";
  if (/(ж\s*\/\s*б|банка|\bcan\b|жест|алюм)/.test(t)) return "can";
  return t || "";
}

function resolve_image_path(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return path.resolve(p);
  const base = path.basename(p);
  const candidates = [
    path.join("/app/tmp/homepage-missing-products/original", base),
    path.join(path.dirname(SOURCE), "original", base),
    path.join(ROOT, "data/imports/homepage-missing-products/original", base),
    path.resolve(p),
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

function load_rows() {
  const data = JSON.parse(fs.readFileSync(path.resolve(SOURCE), "utf8"));
  const items = Array.isArray(data) ? data : data.items;
  return items.map((r, i) => {
    const package_type = String(r.package_type || "").trim();
    return {
      row: i + 1,
      id: r.id || null,
      proposed_sku: String(r.proposed_sku || "").trim(),
      source_name: String(r.source_name || "").trim(),
      brand: String(r.brand || "").trim(),
      flavor: String(r.flavor || "").trim(),
      sugar_free: r.sugar_free === true,
      volume_text: String(r.volume_text || "").trim(),
      volume_ml: Number(r.volume_ml),
      package_type,
      package_norm: r.package_norm || normalize_package(package_type),
      category_slug: String(r.category_slug || "").trim(),
      category_slug_candidates: Array.isArray(r.category_slug_candidates)
        ? r.category_slug_candidates.map(String)
        : [],
      local_image_path: String(
        r.local_original_path || r.local_image_path || "",
      ).trim(),
      source_product_url: r.source_product_url || null,
      review_decision: r.review_decision || null,
      role: r.role || null,
      target_group: r.target_group || null,
      units_per_package: 1,
      package_requires_review: true,
    };
  });
}

function validate_business_rules(row, errors) {
  if (row.proposed_sku === "ZY-COCACOLAZERO-330-GLASS-001") {
    if (row.brand !== "Coca-Cola") errors.push("coke_zero_brand");
    if (row.sugar_free !== true) errors.push("coke_zero_not_sugar_free");
    if (row.volume_ml !== 330) errors.push("coke_zero_volume");
    if (row.package_norm !== "glass") errors.push("coke_zero_package");
    if (row.category_slug !== "kola") errors.push("coke_zero_category");
  }
  if (row.proposed_sku === "ZY-SPRITE-2000-PET-001") {
    if (row.brand !== "Sprite") errors.push("sprite_brand");
    if (row.volume_ml !== 2000) errors.push("sprite_volume");
    if (row.package_norm !== "pet") errors.push("sprite_package");
    if (row.category_slug !== "gazirovannye-napitki") errors.push("sprite_category");
  }
  if (row.proposed_sku === "ZY-ADRENALINE-250-CAN-001") {
    if (row.brand !== "Adrenaline Rush") errors.push("adr_brand");
    if (row.volume_ml !== 250) errors.push("adr_small_volume");
    if (row.package_norm !== "can") errors.push("adr_package");
    if (row.units_per_package !== 1) errors.push("adr_not_single");
    if (row.category_slug !== "energeticheskie-napitki") errors.push("adr_category");
  }
  if (row.proposed_sku === "ZY-ADRENALINE-449-CAN-001") {
    if (row.brand !== "Adrenaline Rush") errors.push("adr_brand");
    if (row.volume_ml !== 449) errors.push("adr_large_volume");
    if (row.package_norm !== "can") errors.push("adr_package");
    if (row.units_per_package !== 1) errors.push("adr_not_single");
    if (row.category_slug !== "energeticheskie-napitki") errors.push("adr_category");
  }
  // Hard exclusions
  if (row.proposed_sku === "ZY-ADRENALINE-330-CAN-001") {
    errors.push("adrenaline_330_excluded");
  }
  if (row.review_decision && row.review_decision !== "approved_new") {
    errors.push(`not_approved_new:${row.review_decision}`);
  }
  if (row.role && row.role !== "primary") {
    errors.push(`not_primary:${row.role}`);
  }
}

async function main() {
  const rows = load_rows();
  const before = await snapshot_guard();

  const cats = await prisma.categories.findMany({
    select: { id: true, slug: true, name: true, is_active: true, parent_id: true },
    orderBy: { slug: "asc" },
  });
  const cat_by_slug = new Map(cats.map((c) => [c.slug, c]));

  const existing_skus = new Set(
    (await prisma.products.findMany({ select: { sku: true } })).map((p) => p.sku),
  );

  const related = await prisma.products.findMany({
    where: {
      OR: [
        { name: { contains: "Zero", mode: "insensitive" }, brand: { contains: "Coca", mode: "insensitive" } },
        { name: { contains: "Sprite", mode: "insensitive" } },
        { brand: { contains: "Sprite", mode: "insensitive" } },
        { name: { contains: "Adrenaline", mode: "insensitive" } },
        { brand: { contains: "Adrenaline", mode: "insensitive" } },
      ],
    },
    select: {
      sku: true,
      name: true,
      brand: true,
      volume_text: true,
      package_type: true,
    },
  });

  const preview_items = [];
  const seen_sku = new Map();
  let preview_ok = 0;
  let preview_failed = 0;

  const batch_errors = [];
  if (rows.length !== EXPECTED) {
    batch_errors.push(`expected_${EXPECTED}_got_${rows.length}`);
  }
  const sku_set = new Set(rows.map((r) => r.proposed_sku));
  for (const s of EXPECTED_SKUS) {
    if (!sku_set.has(s)) batch_errors.push(`missing_expected_sku:${s}`);
  }
  for (const r of rows) {
    if (!EXPECTED_SKUS.includes(r.proposed_sku)) {
      batch_errors.push(`unexpected_sku:${r.proposed_sku}`);
    }
  }

  for (const row of rows) {
    const errors = [...batch_errors];
    const img_path = resolve_image_path(row.local_image_path);
    let mime = null;
    let size = 0;
    let file_sha = null;
    let readable = false;

    if (!row.proposed_sku) errors.push("proposed_sku_missing");
    if (!row.source_name) errors.push("source_name_missing");
    if (!row.brand) errors.push("brand_missing");
    if (!row.volume_text) errors.push("volume_text_missing");
    if (!Number.isFinite(row.volume_ml)) errors.push("volume_missing");
    if (!row.package_type) errors.push("package_missing");
    else if (!ALLOWED_PACKAGES.has(row.package_norm)) {
      errors.push(`package_undetermined:${row.package_type}`);
    }
    if (!row.category_slug) errors.push("category_slug_missing");
    else if (!ALLOWED_CATEGORIES.has(row.category_slug)) {
      errors.push(`category_slug_unexpected:${row.category_slug}`);
    }
    if (!row.local_image_path) errors.push("local_image_path_missing");

    validate_business_rules(row, errors);

    if (row.proposed_sku) {
      if (seen_sku.has(row.proposed_sku)) {
        errors.push(`duplicate_sku_in_batch:${seen_sku.get(row.proposed_sku)}`);
      } else {
        seen_sku.set(row.proposed_sku, row.row);
      }
      if (existing_skus.has(row.proposed_sku)) {
        errors.push("sku_exists_in_tinda");
      }
    }

    // exact duplicate: same brand+volume+package (glass Zero vs can Zero is OK)
    const exact_hit = related.find((p) => {
      const same_brand =
        String(p.brand || "").toLowerCase() === row.brand.toLowerCase() ||
        (row.brand === "Coca-Cola" &&
          /coca/i.test(String(p.brand || "")) &&
          /zero/i.test(String(p.name || "")));
      if (!same_brand && row.brand === "Coca-Cola") {
        // Coke Zero related cans are different package — not exact
      }
      const vol = String(p.volume_text || "").replace(",", ".");
      const row_vol = row.volume_text.replace(",", ".");
      const same_vol =
        vol.includes(String(row.volume_ml)) ||
        vol === row_vol ||
        (row.volume_ml === 330 && /0[.,]?33/.test(vol)) ||
        (row.volume_ml === 2000 && /\b2\b/.test(vol)) ||
        (row.volume_ml === 250 && /0[.,]?25|250/.test(vol)) ||
        (row.volume_ml === 449 && /0[.,]?449|449/.test(vol));
      const pkg = normalize_package(p.package_type);
      return (
        String(p.brand || "").toLowerCase() === row.brand.toLowerCase() &&
        same_vol &&
        pkg === row.package_norm
      );
    });
    if (exact_hit) {
      errors.push(`exact_duplicate_exists:${exact_hit.sku}`);
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
        // readable via sharp
        await sharp(buf, { failOn: "error" }).metadata();
        if (size > PRODUCT_IMAGE_MAX_BYTES) errors.push("image_too_large");
      } catch (e) {
        errors.push(`image_unreadable:${e?.message || e}`);
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
      category_name: cat?.name || null,
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
            is_new: true,
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
  const local_image_urls = created_results.every(
    (r) =>
      typeof r.image_url === "string" &&
      r.image_url.startsWith("/uploads/products/") &&
      r.image_url.endsWith(".webp"),
  );

  const categories_used = {};
  for (const r of results) {
    if (r.category_slug && cat_by_slug.get(r.category_slug)) {
      categories_used[r.category_slug] = cat_by_slug.get(r.category_slug);
    }
  }

  const report = {
    generated_at: now_iso(),
    mode: MODE,
    backup_path: BACKUP,
    source: path.resolve(SOURCE),
    uploads_root: UPLOADS_ROOT,
    expected_rows: EXPECTED,
    expected_skus: EXPECTED_SKUS,
    row_count: rows.length,
    note: "Create-only import of 4 homepage-missing approved_new products. No schema/seed. package_requires_review in report only. Existing products/prices/images untouched.",
    package_requires_review: true,
    package_requires_review_detail: {
      field_in_schema: false,
      flag_value: true,
      skus: EXPECTED_SKUS,
      note: "Transport packaging may be multipack at source; units_per_package forced to 1 for TINDA unit cards.",
    },
    categories: categories_used,
    related_existing_not_duplicates: related,
    preview: {
      ok: preview_ok,
      failed: preview_failed,
      candidates_exactly_4: rows.length === EXPECTED,
      proposed_skus_unique: seen_sku.size === rows.length,
      skus_absent_in_db: EXPECTED_SKUS.every((s) => !existing_skus.has(s)),
    },
    counts: { created, skipped, failed, images_uploaded, preview_ok, preview_failed },
    local_image_urls_ok: MODE === "apply" ? local_image_urls : null,
    before,
    after,
    orderable_price_drift,
    guard_ok: {
      orders_unchanged: before.orders === after.orders,
      order_items_unchanged: before.order_items === after.order_items,
      clients_unchanged: before.clients === after.clients,
      interest_unchanged: before.interest === after.interest,
      no_orderable_price_drift: orderable_price_drift.length === 0,
      products_delta:
        MODE === "apply" ? after.products_total - before.products_total : 0,
    },
    created_skus: created_results.map((r) => r.proposed_sku),
    webp_uploaded: created_results.map((r) => ({
      sku: r.proposed_sku,
      product_id: r.product_id,
      image_url: r.image_url,
    })),
    results: results.map((r) => ({
      row: r.row,
      id: r.id,
      proposed_sku: r.proposed_sku,
      source_name: r.source_name,
      brand: r.brand,
      sugar_free: r.sugar_free,
      volume_text: r.volume_text,
      volume_ml: r.volume_ml,
      package_type: r.package_type,
      package_norm: r.package_norm,
      category_slug: r.category_slug,
      category_id: r.category_id,
      apply_status: r.apply_status,
      product_id: r.product_id,
      image_url: r.image_url,
      upload_result: r.upload_result,
      validation_errors: r.validation_errors,
      error_message: r.error_message,
      package_requires_review: true,
    })),
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");

  const lines = [
    `homepage-missing-products import ${MODE}`,
    `generated_at: ${report.generated_at}`,
    `backup: ${BACKUP || "(none)"}`,
    `source: ${report.source}`,
    `rows: ${rows.length} (expected ${EXPECTED})`,
    `preview_ok/failed: ${preview_ok}/${preview_failed}`,
    `created/skipped/failed: ${created}/${skipped}/${failed}`,
    `images_uploaded: ${images_uploaded}`,
    `package_requires_review: true`,
    `products_total: ${before.products_total} -> ${after.products_total}`,
    `showcase_active: ${before.showcase_active} -> ${after.showcase_active}`,
    `orderable_active: ${before.orderable_active} -> ${after.orderable_active}`,
    `no_price: ${before.no_price} -> ${after.no_price}`,
    `guard orders/items/clients/interest unchanged: ${report.guard_ok.orders_unchanged}/${report.guard_ok.order_items_unchanged}/${report.guard_ok.clients_unchanged}/${report.guard_ok.interest_unchanged}`,
    `orderable_price_drift: ${orderable_price_drift.length}`,
    "",
    "SKUs:",
    ...results.map(
      (r) =>
        `  ${r.apply_status.padEnd(12)} ${r.proposed_sku}  ${r.category_slug}  ${r.image_url || "-"}  ${r.error_message || ""}`,
    ),
  ];
  const txt = lines.join("\n") + "\n";
  if (REPORT_TXT) {
    fs.mkdirSync(path.dirname(REPORT_TXT), { recursive: true });
    fs.writeFileSync(REPORT_TXT, txt);
  }
  console.log(txt);
  console.log(`report_json: ${REPORT_JSON}`);
  if (REPORT_TXT) console.log(`report_txt: ${REPORT_TXT}`);

  if (MODE === "preview" && preview_failed > 0) process.exitCode = 2;
  if (MODE === "apply" && (failed > 0 || created !== EXPECTED)) process.exitCode = 3;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
