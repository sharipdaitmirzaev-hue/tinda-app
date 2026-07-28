#!/usr/bin/env tsx
/**
 * Catalog normalize + safe dedupe script for ТИНДА.
 *
 * Default: dry-run (no writes).
 * Apply:   npx tsx scripts/catalog-normalize-dedupe.ts --apply
 *
 * Safe to re-run. Uses a transaction for merges. Does not touch env secrets.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  find_merge_candidate_groups,
  merge_product_duplicates,
  normalize_all_products,
  type ProductRow,
} from "../src/lib/catalog/product-dedupe";

async function main() {
  const apply = process.argv.includes("--apply");
  const merge = process.argv.includes("--merge");

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        merge_enabled: merge,
      },
      null,
      2,
    ),
  );

  const normalize = await normalize_all_products(prisma, { apply });
  console.log(
    JSON.stringify(
      {
        normalize: {
          scanned: normalize.scanned,
          name_updates: normalize.name_updates,
          volume_updates: normalize.volume_updates,
          sample_ids: normalize.updated_ids.slice(0, 10),
        },
      },
      null,
      2,
    ),
  );

  const products = (await prisma.products.findMany({
    orderBy: { created_at: "asc" },
  })) as ProductRow[];

  const groups = find_merge_candidate_groups(products);
  const safe = groups.filter((g) => g.auto_merge_safe);
  const doubtful = groups.filter((g) => !g.auto_merge_safe);

  console.log(
    JSON.stringify(
      {
        duplicates: {
          groups: groups.length,
          auto_merge_safe: safe.length,
          doubtful: doubtful.length,
          doubtful_sample: doubtful.slice(0, 10).map((g) => ({
            key: g.key,
            reason: g.reason,
            skus: g.products.map((p) => p.sku),
            prices: g.products.map((p) =>
              p.price_amount === null ? null : String(p.price_amount),
            ),
          })),
        },
      },
      null,
      2,
    ),
  );

  if (!merge) {
    console.log(
      "Merge skipped (pass --merge to merge auto-safe groups). Normalization above may still apply.",
    );
    return;
  }

  if (!apply) {
    console.log("Dry-run: would merge", safe.length, "group(s).");
    return;
  }

  let merged_groups = 0;
  let removed = 0;
  const relinked = { cart_items: 0, order_items: 0, interest_requests: 0 };

  await prisma.$transaction(async (tx) => {
    // Re-load inside transaction after optional normalize
    const fresh = (await tx.products.findMany({
      orderBy: { created_at: "asc" },
    })) as ProductRow[];
    const fresh_groups = find_merge_candidate_groups(fresh).filter(
      (g) => g.auto_merge_safe,
    );

    for (const group of fresh_groups) {
      const result = await merge_product_duplicates(tx, group.products);
      merged_groups += 1;
      removed += result.removed_ids.length;
      relinked.cart_items += result.relinked.cart_items;
      relinked.order_items += result.relinked.order_items;
      relinked.interest_requests += result.relinked.interest_requests;
    }
  });

  // Second normalize pass (idempotent) after merges
  const normalize_again = await normalize_all_products(prisma, { apply: true });

  console.log(
    JSON.stringify(
      {
        merge_result: { merged_groups, removed, relinked },
        normalize_after_merge: {
          name_updates: normalize_again.name_updates,
          volume_updates: normalize_again.volume_updates,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
