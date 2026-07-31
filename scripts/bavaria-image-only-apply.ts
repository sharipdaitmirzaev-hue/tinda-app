/**
 * Production image-only apply for Bavaria missing images (PR #20).
 *
 * Updates ONLY products.image_url from the image-update manifest.
 * Does NOT create products, change categories/prices/active/orderable/names/SKU.
 *
 * Usage:
 *   npx tsx scripts/bavaria-image-only-apply.ts \
 *     --i-understand-and-have-backup \
 *     --backup-path=/backups/....sql \
 *     --manifest=artifacts/bavaria-import/image-completion-2026-07-31/image-update-manifest.json
 */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { upload_product_image } from "../src/lib/storage/product-images";

const ROOT = process.cwd();
const EXPECTED_COUNT = 56;
const EXCLUDED = new Set([
  "BAVARIA-COLALE-COLA-LE-450-GLASS",
  "BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN",
]);
const MANUAL = new Set([
  "BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS",
  "BAVARIA-BAVARIYA-APELSIN-450-GLASS",
  "BAVARIA-BAVARIYA-KOLA-450-GLASS",
  "BAVARIA-BAVARIYA-YABLOKO-450-GLASS",
  "BAVARIA-TBAU-SPORT-MANUAL",
]);

type ManifestItem = {
  sku: string;
  action: string;
  fields_to_change: string[];
  fields_forbidden: string[];
  local_processed_path: string;
  match_confidence?: string;
  source_priority?: string;
};

type Manifest = {
  mode?: string;
  kind?: string;
  item_count: number;
  items: ManifestItem[];
};

function arg_value(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function sha256_file(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

type Snapshot = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category_id: string;
  volume_text: string | null;
  package_type: string | null;
  description: string | null;
  availability: string;
  sales_status: string;
  is_active: boolean;
  price_amount: unknown;
  price_currency: string;
  image_url: string | null;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  min_order_qty: number;
  allow_piece_sale: boolean;
  units_per_package: number;
  sale_unit: string;
};

function snapshot_of(p: Snapshot) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category_id: p.category_id,
    volume_text: p.volume_text,
    package_type: p.package_type,
    description: p.description,
    availability: p.availability,
    sales_status: p.sales_status,
    is_active: p.is_active,
    price_amount: p.price_amount === null ? null : String(p.price_amount),
    price_currency: p.price_currency,
    image_url: p.image_url,
    is_promo: p.is_promo,
    is_new: p.is_new,
    is_hit: p.is_hit,
    min_order_qty: p.min_order_qty,
    allow_piece_sale: p.allow_piece_sale,
    units_per_package: p.units_per_package,
    sale_unit: p.sale_unit,
  };
}

function changed_keys(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}

async function main() {
  const confirmed = process.argv.includes("--i-understand-and-have-backup");
  const backup_path = arg_value("--backup-path");
  const manifest_rel =
    arg_value("--manifest") ||
    "artifacts/bavaria-import/image-completion-2026-07-31/image-update-manifest.json";

  if (!confirmed) {
    throw new Error("Refusing to run without --i-understand-and-have-backup");
  }
  if (!backup_path) {
    throw new Error("Missing --backup-path");
  }
  if (!existsSync(backup_path) || statSync(backup_path).size < 1000) {
    throw new Error(`Backup missing or too small: ${backup_path}`);
  }
  const backup_sha = sha256_file(backup_path);
  const backup_size = statSync(backup_path).size;

  const manifest_path = path.isAbsolute(manifest_rel)
    ? manifest_rel
    : path.join(ROOT, manifest_rel);
  if (!existsSync(manifest_path)) {
    throw new Error(`Manifest not found: ${manifest_path}`);
  }
  const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as Manifest;

  if (manifest.kind !== "image_update_only") {
    throw new Error(`Unexpected manifest kind: ${manifest.kind}`);
  }
  if (!Array.isArray(manifest.items) || manifest.items.length !== EXPECTED_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_COUNT} items, got ${manifest.items?.length}`,
    );
  }
  if (manifest.item_count !== EXPECTED_COUNT) {
    throw new Error(`item_count ${manifest.item_count} != ${EXPECTED_COUNT}`);
  }

  for (const item of manifest.items) {
    if (item.action !== "update_image_only") {
      throw new Error(`${item.sku}: bad action ${item.action}`);
    }
    if (
      !Array.isArray(item.fields_to_change) ||
      item.fields_to_change.length !== 1 ||
      item.fields_to_change[0] !== "image_url"
    ) {
      throw new Error(`${item.sku}: fields_to_change must be ["image_url"]`);
    }
    if (EXCLUDED.has(item.sku) || MANUAL.has(item.sku)) {
      throw new Error(`${item.sku}: excluded/manual SKU present in manifest`);
    }
    if (!item.local_processed_path) {
      throw new Error(`${item.sku}: missing local_processed_path`);
    }
    const img_abs = path.isAbsolute(item.local_processed_path)
      ? item.local_processed_path
      : path.join(ROOT, item.local_processed_path);
    if (!existsSync(img_abs)) {
      throw new Error(`${item.sku}: processed image missing: ${img_abs}`);
    }
  }

  const skus = manifest.items.map((i) => i.sku);
  if (new Set(skus).size !== skus.length) {
    throw new Error("Duplicate SKUs in manifest");
  }

  const prisma = new PrismaClient();
  const out_dir = path.join(
    ROOT,
    "artifacts/bavaria-import",
    `${stamp()}-image-only-apply`,
  );
  mkdirSync(out_dir, { recursive: true });

  const result = {
    started_at: new Date().toISOString(),
    finished_at: null as string | null,
    kind: "image_update_only",
    backup_path,
    backup_size,
    backup_sha256: backup_sha,
    manifest_path: path.relative(ROOT, manifest_path),
    expected_count: EXPECTED_COUNT,
    updated: [] as string[],
    skipped: [] as Array<{ sku: string; reason: string }>,
    errors: [] as Array<{ sku: string; error: string }>,
    field_changes: {} as Record<string, string[]>,
    new_image_urls: {} as Record<string, string>,
  };

  try {
    for (const item of manifest.items) {
      const sku = item.sku;
      try {
        const product = await prisma.products.findUnique({
          where: { sku },
          select: {
            id: true,
            sku: true,
            name: true,
            brand: true,
            category_id: true,
            volume_text: true,
            package_type: true,
            description: true,
            availability: true,
            sales_status: true,
            is_active: true,
            price_amount: true,
            price_currency: true,
            image_url: true,
            is_promo: true,
            is_new: true,
            is_hit: true,
            min_order_qty: true,
            allow_piece_sale: true,
            units_per_package: true,
            sale_unit: true,
          },
        });
        if (!product) {
          result.errors.push({ sku, error: "product_not_found" });
          continue;
        }
        if ((product.image_url || "").trim()) {
          result.skipped.push({ sku, reason: "image_url_already_set" });
          continue;
        }

        const before = snapshot_of(product as Snapshot);
        const img_abs = path.isAbsolute(item.local_processed_path)
          ? item.local_processed_path
          : path.join(ROOT, item.local_processed_path);
        const buffer = readFileSync(img_abs);
        const stored = await upload_product_image({
          product_id: product.id,
          buffer,
          filename: path.basename(img_abs),
          mime_type: "image/webp",
        });

        await prisma.products.update({
          where: { id: product.id },
          data: { image_url: stored.image_url },
        });

        const after_row = await prisma.products.findUniqueOrThrow({
          where: { id: product.id },
          select: {
            id: true,
            sku: true,
            name: true,
            brand: true,
            category_id: true,
            volume_text: true,
            package_type: true,
            description: true,
            availability: true,
            sales_status: true,
            is_active: true,
            price_amount: true,
            price_currency: true,
            image_url: true,
            is_promo: true,
            is_new: true,
            is_hit: true,
            min_order_qty: true,
            allow_piece_sale: true,
            units_per_package: true,
            sale_unit: true,
          },
        });
        const after = snapshot_of(after_row as Snapshot);
        const changed = changed_keys(before, after);
        result.field_changes[sku] = changed;
        if (changed.length !== 1 || changed[0] !== "image_url") {
          result.errors.push({
            sku,
            error: `unexpected_field_changes:${changed.join(",")}`,
          });
          continue;
        }
        result.updated.push(sku);
        result.new_image_urls[sku] = stored.image_url;
      } catch (e) {
        result.errors.push({
          sku,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  result.finished_at = new Date().toISOString();
  const summary = {
    ...result,
    updated_count: result.updated.length,
    skipped_count: result.skipped.length,
    error_count: result.errors.length,
  };
  writeFileSync(
    path.join(out_dir, "apply-result.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));

  if (result.errors.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
