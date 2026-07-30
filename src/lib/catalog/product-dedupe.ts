import type { Prisma, PrismaClient } from "@prisma/client";
import {
  normalize_product_name,
  normalize_volume_text,
  product_dedupe_key,
} from "@/lib/catalog/product-text-normalize";

export type ProductRow = {
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
  price_amount: Prisma.Decimal | number | null;
  price_currency: string;
  category_id: string;
  created_at: Date;
  updated_at: Date;
};

export type MergeCandidateGroup = {
  key: string;
  products: ProductRow[];
  auto_merge_safe: boolean;
  reason: string;
};

function price_num(value: ProductRow["price_amount"]): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function completeness_score(p: ProductRow): number {
  let score = 0;
  if (p.is_active) score += 10;
  if (p.sales_status === "orderable") score += 8;
  if (price_num(p.price_amount) !== null && Number(price_num(p.price_amount)) > 0)
    score += 6;
  if (p.image_url) score += 4;
  if (p.description) score += 2;
  if (p.brand) score += 1;
  if (p.volume_text) score += 1;
  // Prefer older catalog records as primary when equal completeness.
  score += Math.max(0, 1 - p.created_at.getTime() / 1e15);
  return score;
}

/** Choose keeper: fullest data, then earliest created_at. */
export function choose_keeper(products: ProductRow[]): ProductRow {
  return [...products].sort((a, b) => {
    const diff = completeness_score(b) - completeness_score(a);
    if (diff !== 0) return diff;
    return a.created_at.getTime() - b.created_at.getTime();
  })[0]!;
}

function prices_conflict(products: ProductRow[]): boolean {
  const priced = products
    .map((p) => price_num(p.price_amount))
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  if (priced.length <= 1) return false;
  const first = priced[0]!;
  return priced.some((v) => Math.abs(v - first) > 0.009);
}

/**
 * Group products that look like commercial duplicates.
 * Auto-merge only when key matches and prices do not conflict.
 */
export function find_merge_candidate_groups(
  products: ProductRow[],
): MergeCandidateGroup[] {
  const by_key = new Map<string, ProductRow[]>();
  for (const product of products) {
    const key = product_dedupe_key(product);
    const list = by_key.get(key) ?? [];
    list.push(product);
    by_key.set(key, list);
  }

  const groups: MergeCandidateGroup[] = [];
  for (const [key, list] of by_key) {
    if (list.length < 2) continue;
    const skus = new Set(list.map((p) => p.sku));
    if (skus.size < 2) continue;

    if (prices_conflict(list)) {
      groups.push({
        key,
        products: list,
        auto_merge_safe: false,
        reason: "Отличаются цены — требуется ручная проверка",
      });
      continue;
    }

    groups.push({
      key,
      products: list,
      auto_merge_safe: true,
      reason: "Совпадают бренд, нормализованное название, объём и упаковка",
    });
  }
  return groups;
}

export type MergeResult = {
  keeper_id: string;
  removed_ids: string[];
  relinked: {
    cart_items: number;
    order_items: number;
    interest_requests: number;
  };
};

/**
 * Merge duplicate products into keeper inside an existing transaction.
 * Relinks cart_items, order_items, interest_requests; then deletes duplicates.
 */
export async function merge_product_duplicates(
  tx: Prisma.TransactionClient,
  products: ProductRow[],
): Promise<MergeResult> {
  if (products.length < 2) {
    throw new Error("Для объединения нужно минимум 2 товара");
  }

  const keeper = choose_keeper(products);
  const duplicates = products.filter((p) => p.id !== keeper.id);

  // Prefer keeper image/price/description if missing.
  const patch: Prisma.productsUpdateInput = {};
  if (!keeper.image_url) {
    const with_image = duplicates.find((p) => p.image_url);
    if (with_image?.image_url) patch.image_url = with_image.image_url;
  }
  if (price_num(keeper.price_amount) === null) {
    const with_price = duplicates.find(
      (p) => price_num(p.price_amount) !== null && Number(price_num(p.price_amount)) > 0,
    );
    if (with_price) {
      patch.price_amount = with_price.price_amount as Prisma.Decimal;
      patch.price_currency = with_price.price_currency;
      if (keeper.sales_status === "showcase" && with_price.sales_status === "orderable") {
        patch.sales_status = "orderable";
      }
    }
  }
  if (!keeper.description) {
    const with_desc = duplicates.find((p) => p.description);
    if (with_desc?.description) patch.description = with_desc.description;
  }
  if (!keeper.brand) {
    const with_brand = duplicates.find((p) => p.brand);
    if (with_brand?.brand) patch.brand = with_brand.brand;
  }
  if (!keeper.volume_text) {
    const with_vol = duplicates.find((p) => p.volume_text);
    if (with_vol?.volume_text) {
      patch.volume_text = normalize_volume_text(with_vol.volume_text);
    }
  }

  patch.name = normalize_product_name(keeper.name);
  if (keeper.volume_text) {
    patch.volume_text = normalize_volume_text(keeper.volume_text);
  }

  if (Object.keys(patch).length > 0) {
    await tx.products.update({ where: { id: keeper.id }, data: patch });
  }

  let cart_items = 0;
  let order_items = 0;
  let interest_requests = 0;

  for (const dup of duplicates) {
    // cart_items: unique (cart_id, product_id) — merge quantities if both present
    const dup_cart_items = await tx.cart_items.findMany({
      where: { product_id: dup.id },
    });
    for (const item of dup_cart_items) {
      const existing = await tx.cart_items.findUnique({
        where: {
          cart_id_product_id: {
            cart_id: item.cart_id,
            product_id: keeper.id,
          },
        },
      });
      if (existing) {
        await tx.cart_items.update({
          where: { id: existing.id },
          data: { qty: existing.qty + item.qty },
        });
        await tx.cart_items.delete({ where: { id: item.id } });
      } else {
        await tx.cart_items.update({
          where: { id: item.id },
          data: { product_id: keeper.id },
        });
      }
      cart_items += 1;
    }

    const oi = await tx.order_items.updateMany({
      where: { product_id: dup.id },
      data: { product_id: keeper.id },
    });
    order_items += oi.count;

    const ir = await tx.product_interest_requests.updateMany({
      where: { product_id: dup.id },
      data: { product_id: keeper.id },
    });
    interest_requests += ir.count;

    // FK check before delete
    const leftover_cart = await tx.cart_items.count({
      where: { product_id: dup.id },
    });
    const leftover_orders = await tx.order_items.count({
      where: { product_id: dup.id },
    });
    const leftover_interest = await tx.product_interest_requests.count({
      where: { product_id: dup.id },
    });
    if (leftover_cart + leftover_orders + leftover_interest > 0) {
      throw new Error(
        `Нельзя удалить товар ${dup.sku}: остались связи (cart=${leftover_cart}, orders=${leftover_orders}, interest=${leftover_interest})`,
      );
    }

    await tx.products.delete({ where: { id: dup.id } });
  }

  return {
    keeper_id: keeper.id,
    removed_ids: duplicates.map((p) => p.id),
    relinked: { cart_items, order_items, interest_requests },
  };
}

export type NormalizeResult = {
  scanned: number;
  name_updates: number;
  volume_updates: number;
  updated_ids: string[];
};

/** Idempotent normalization of name + volume_text for all products. */
export async function normalize_all_products(
  db: PrismaClient | Prisma.TransactionClient,
  options: { apply: boolean } = { apply: false },
): Promise<NormalizeResult> {
  const products = await db.products.findMany({
    select: { id: true, name: true, volume_text: true },
  });

  let name_updates = 0;
  let volume_updates = 0;
  const updated_ids: string[] = [];

  for (const product of products) {
    const next_name = normalize_product_name(product.name);
    const next_volume = normalize_volume_text(product.volume_text);
    const name_changed = next_name !== product.name;
    const volume_changed = next_volume !== product.volume_text;
    if (!name_changed && !volume_changed) continue;

    if (name_changed) name_updates += 1;
    if (volume_changed) volume_updates += 1;
    updated_ids.push(product.id);

    if (options.apply) {
      await db.products.update({
        where: { id: product.id },
        data: {
          ...(name_changed ? { name: next_name } : {}),
          ...(volume_changed ? { volume_text: next_volume } : {}),
        },
      });
    }
  }

  return {
    scanned: products.length,
    name_updates,
    volume_updates,
    updated_ids,
  };
}
