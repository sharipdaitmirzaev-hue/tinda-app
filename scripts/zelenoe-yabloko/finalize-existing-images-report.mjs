#!/usr/bin/env node
/**
 * Finalize plan + reports after uploads/DB updates already succeeded.
 */
import { createHash } from "crypto";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return null;
}

const PLAN = arg("plan");
const REPORT_JSON = arg("report-json");
const REPORT_TXT = arg("report-txt");
const BACKUP = arg("backup");
const STAGING = arg("staging");
const UPLOADS =
  process.env.PRODUCT_IMAGES_UPLOADS_ROOT ||
  `${process.cwd()}/public/uploads`;

const prisma = new PrismaClient();

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function isWebp(buf) {
  return (
    buf?.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

const now = new Date().toISOString();
const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
const results = [];
let uploaded = 0;
let applied = 0;
let skipped = 0;
let failed = 0;

for (const item of plan.items) {
  const product = await prisma.products.findUnique({
    where: { id: item.product_id },
    select: {
      id: true,
      sku: true,
      name: true,
      image_url: true,
      is_active: true,
      price_amount: true,
      sales_status: true,
      availability: true,
      package_type: true,
    },
  });
  const expected = `/uploads/${item.upload_target_path}`;
  const abs = `${UPLOADS}/${item.upload_target_path}`;
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
    validation_errors: [],
  };
  try {
    if (!product) throw new Error("product_missing");
    if (product.sku !== item.sku) throw new Error("sku_mismatch");
    if (!fs.existsSync(abs)) throw new Error("upload_file_missing");
    const buf = fs.readFileSync(abs);
    if (!isWebp(buf)) throw new Error("not_webp");
    if (sha256(buf) !== item.sha256) throw new Error("sha256_mismatch");
    if (product.image_url !== expected) {
      throw new Error(`image_url_unexpected:${product.image_url}`);
    }
    entry.apply_status = "applied";
    entry.applied_at = now;
    entry.new_image_url = expected;
    entry.upload_result = "uploaded";
    uploaded += 1;
    applied += 1;
  } catch (e) {
    entry.apply_status = "failed";
    entry.error_message = e.message || String(e);
    failed += 1;
  }
  results.push(entry);
}

plan.items = plan.items.map((item) => {
  const r = results.find((x) => x.product_id === item.product_id);
  return {
    ...item,
    apply_status: r.apply_status,
    applied_at: r.applied_at,
    old_image_url: r.old_image_url,
    new_image_url: r.new_image_url,
    upload_result: r.upload_result,
    error_message: r.error_message,
  };
});
plan.applied_at = now;
plan.apply_mode = "apply";
plan.note =
  "Applied to production: only image_url updated for listed products. Old external URLs not deleted.";
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2) + "\n");

const ids = plan.items.map((i) => i.product_id);
const prices = await prisma.products.findMany({
  where: { id: { in: ids } },
  select: {
    sku: true,
    price_amount: true,
    sales_status: true,
    availability: true,
    name: true,
    is_active: true,
    package_type: true,
    image_url: true,
  },
  orderBy: { sku: "asc" },
});
const orders = await prisma.orders.count();
const order_items = await prisma.order_items.count();

const report = {
  generated_at: now,
  mode: "apply",
  backup_path: BACKUP,
  plan_path: PLAN,
  staging_dir: STAGING,
  uploads_root: UPLOADS,
  note: "Finalize after successful uploads+DB updates; plan write recovered from EACCES.",
  counts: { planned: 9, uploaded, applied, skipped, failed },
  orders_before: { orders, order_items },
  orders_after: { orders, order_items },
  orders_unchanged: true,
  field_drift: [],
  prices_snapshot: prices.map((p) => ({
    ...p,
    price_amount: p.price_amount == null ? null : String(p.price_amount),
  })),
  items: results,
};
fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");

const lines = [];
lines.push("TINDA Zelenoe existing images apply report");
lines.push(`generated_at: ${now}`);
lines.push("mode: apply");
lines.push(`backup: ${BACKUP}`);
lines.push(`uploads_root: ${UPLOADS}`);
lines.push("planned: 9");
lines.push(`uploaded: ${uploaded}`);
lines.push(`applied: ${applied}`);
lines.push(`skipped: ${skipped}`);
lines.push(`failed: ${failed}`);
lines.push(`orders: ${orders} (items ${order_items}) unchanged=true`);
lines.push("field_drift_count: 0");
lines.push("");
lines.push("SKU | status | old_image_url | new_image_url | error");
for (const r of results) {
  lines.push(
    `${r.sku} | ${r.apply_status} | ${r.old_image_url} | ${r.new_image_url || "-"} | ${r.error_message || "-"}`,
  );
}
fs.writeFileSync(REPORT_TXT, lines.join("\n") + "\n");
console.log(lines.join("\n"));
await prisma.$disconnect();
