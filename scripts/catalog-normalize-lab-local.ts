#!/usr/bin/env tsx
/**
 * Local lab: import products-snapshot.json and apply normalize.
 * Does NOT touch production.
 *
 *   npx tsx scripts/catalog-normalize-lab-local.ts \
 *     --snapshot tmp/.../products-snapshot.json --apply-normalize
 */
import { existsSync, readFileSync } from "fs";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { normalize_all_products } from "../src/lib/catalog/product-dedupe";

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  description: string | null;
  availability: string;
  sales_status: string;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string | null;
  is_active: boolean;
};

function load_snapshot(path: string): CatalogItem[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as CatalogItem[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Empty snapshot: ${path}`);
  }
  return raw;
}

async function main() {
  const apply = process.argv.includes("--apply-normalize");
  const snap_idx = process.argv.indexOf("--snapshot");
  const snapshot_path =
    (snap_idx >= 0 ? process.argv[snap_idx + 1] : "") ||
    process.env.CATALOG_SNAPSHOT ||
    "";

  if (!snapshot_path || !existsSync(snapshot_path)) {
    throw new Error(
      "Provide --snapshot path/to/products-snapshot.json from dry-run report",
    );
  }

  const remote = load_snapshot(snapshot_path);
  console.log(JSON.stringify({ snapshot_path, remote_count: remote.length }));

  const category = await prisma.categories.upsert({
    where: { slug: "import-lab-normalize" },
    update: { is_active: true, name: "Import lab" },
    create: {
      slug: "import-lab-normalize",
      name: "Import lab",
      is_active: true,
      sort_order: 999,
    },
  });

  await prisma.products.deleteMany({ where: { category_id: category.id } });

  for (const item of remote) {
    await prisma.products.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        brand: item.brand,
        category_id: category.id,
        volume_text: item.volume_text,
        package_type: item.package_type,
        units_per_package: item.units_per_package || 1,
        sale_unit: item.sale_unit || "шт",
        min_order_qty: item.min_order_qty || 1,
        allow_piece_sale: item.allow_piece_sale ?? false,
        description: item.description,
        availability: item.availability || "in_stock",
        sales_status: item.sales_status || "showcase",
        is_promo: item.is_promo ?? false,
        is_new: item.is_new ?? false,
        is_hit: item.is_hit ?? false,
        image_url: item.image_url,
        is_active: item.is_active ?? true,
      },
      create: {
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category_id: category.id,
        volume_text: item.volume_text,
        package_type: item.package_type,
        units_per_package: item.units_per_package || 1,
        sale_unit: item.sale_unit || "шт",
        min_order_qty: item.min_order_qty || 1,
        allow_piece_sale: item.allow_piece_sale ?? false,
        description: item.description,
        availability: item.availability || "in_stock",
        sales_status: item.sales_status || "showcase",
        is_promo: item.is_promo ?? false,
        is_new: item.is_new ?? false,
        is_hit: item.is_hit ?? false,
        image_url: item.image_url,
        is_active: item.is_active ?? true,
        price_amount: null,
      },
    });
  }

  const before = await normalize_all_products(prisma, { apply: false });
  console.log(JSON.stringify({ dry_run_before: before }, null, 2));

  if (!apply) {
    console.log("Pass --apply-normalize to apply on local lab DB only.");
    return;
  }

  const protected_before = await prisma.products.findMany({
    where: { category_id: category.id },
    select: {
      sku: true,
      brand: true,
      package_type: true,
      units_per_package: true,
      availability: true,
      image_url: true,
      sales_status: true,
      price_amount: true,
    },
  });
  const by_sku = new Map(protected_before.map((p) => [p.sku, p]));

  const first = await normalize_all_products(prisma, { apply: true });
  const second = await normalize_all_products(prisma, { apply: false });
  const third = await normalize_all_products(prisma, { apply: true });

  const after = await prisma.products.findMany({
    where: { category_id: category.id },
    select: {
      sku: true,
      brand: true,
      package_type: true,
      units_per_package: true,
      availability: true,
      image_url: true,
      sales_status: true,
      price_amount: true,
      name: true,
      volume_text: true,
    },
  });

  let protected_field_drift = 0;
  for (const row of after) {
    const prev = by_sku.get(row.sku)!;
    if (
      prev.brand !== row.brand ||
      prev.package_type !== row.package_type ||
      prev.units_per_package !== row.units_per_package ||
      prev.availability !== row.availability ||
      prev.image_url !== row.image_url ||
      prev.sales_status !== row.sales_status ||
      String(prev.price_amount) !== String(row.price_amount)
    ) {
      protected_field_drift += 1;
    }
  }

  const sample = after
    .filter((p) => {
      const src = remote.find((r) => r.sku === p.sku);
      return (
        !!src &&
        (src.name !== p.name ||
          (src.volume_text ?? "") !== (p.volume_text ?? ""))
      );
    })
    .slice(0, 20)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      volume_text: p.volume_text,
      brand: p.brand,
      package_type: p.package_type,
      units_per_package: p.units_per_package,
    }));

  console.log(
    JSON.stringify(
      {
        apply: {
          first_pass: {
            name_updates: first.name_updates,
            volume_updates: first.volume_updates,
          },
          second_dry_run: {
            name_updates: second.name_updates,
            volume_updates: second.volume_updates,
          },
          third_apply: {
            name_updates: third.name_updates,
            volume_updates: third.volume_updates,
          },
          idempotent:
            second.name_updates === 0 &&
            second.volume_updates === 0 &&
            third.name_updates === 0 &&
            third.volume_updates === 0,
          protected_field_drift,
          counts: {
            total: await prisma.products.count(),
            active: await prisma.products.count({ where: { is_active: true } }),
          },
          sample_changed_cards: sample,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
