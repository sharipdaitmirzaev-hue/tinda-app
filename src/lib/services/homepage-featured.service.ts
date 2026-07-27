import { prisma } from "@/lib/db";
import { can_see_client_prices, type AuthUserPayload } from "@/lib/access";
import {
  collect_featured_category_slugs,
  collect_featured_skus,
  HOMEPAGE_FEATURED_ENTRIES,
  resolve_homepage_featured_products,
  type FeaturedProductLike,
} from "@/lib/catalog/homepage-featured";
import {
  serialize_approved_client_product,
  serialize_public_product,
} from "@/lib/catalog/product-serializers";

type DbFeaturedProduct = FeaturedProductLike & {
  category_id: string;
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
  price_amount: unknown;
  price_currency: string;
  created_at: Date;
  updated_at: Date;
  category: { id: string; name: string; slug: string; is_active: boolean } | null;
};

function to_featured_like(
  row: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    volume_text: string | null;
    package_type: string | null;
    is_active: boolean;
    category?: { slug: string } | null;
  },
): FeaturedProductLike {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    volume_text: row.volume_text,
    package_type: row.package_type,
    is_active: row.is_active,
    category_slug: row.category?.slug ?? null,
  };
}

function serialize_featured(
  payload: AuthUserPayload | null,
  product: DbFeaturedProduct,
) {
  const for_serializer = {
    ...product,
    price_amount: product.price_amount as never,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          is_active: product.category.is_active,
        }
      : null,
  };
  return can_see_client_prices(payload)
    ? serialize_approved_client_product(for_serializer)
    : serialize_public_product(for_serializer);
}

/**
 * Load homepage featured products for the current viewer.
 * Read-only: does not mutate products / prices / images.
 */
export async function list_homepage_featured_products(
  payload: AuthUserPayload | null,
) {
  const entries = HOMEPAGE_FEATURED_ENTRIES;
  const skus = collect_featured_skus(entries);
  const category_slugs = collect_featured_category_slugs(entries);

  const [sku_rows, category_rows] = await Promise.all([
    prisma.products.findMany({
      where: {
        sku: { in: skus },
        is_active: true,
        category: { is_active: true },
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, is_active: true },
        },
      },
    }),
    category_slugs.length
      ? prisma.products.findMany({
          where: {
            is_active: true,
            category: {
              is_active: true,
              slug: { in: category_slugs },
            },
          },
          include: {
            category: {
              select: { id: true, name: true, slug: true, is_active: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const by_sku = new Map<string, FeaturedProductLike & { _raw: DbFeaturedProduct }>();
  for (const row of sku_rows) {
    const raw = row as unknown as DbFeaturedProduct;
    by_sku.set(row.sku, { ...to_featured_like(row), _raw: raw });
  }

  const by_category_slug = new Map<
    string,
    Array<FeaturedProductLike & { _raw: DbFeaturedProduct }>
  >();
  for (const row of category_rows) {
    const slug = row.category?.slug;
    if (!slug) continue;
    const raw = row as unknown as DbFeaturedProduct;
    const list = by_category_slug.get(slug) || [];
    list.push({ ...to_featured_like(row), _raw: raw });
    by_category_slug.set(slug, list);
  }

  const ordered = resolve_homepage_featured_products({
    entries,
    by_sku: by_sku as Map<string, FeaturedProductLike>,
    by_category_slug: by_category_slug as Map<string, FeaturedProductLike[]>,
  });

  const raw_by_id = new Map<string, DbFeaturedProduct>();
  for (const v of by_sku.values()) raw_by_id.set(v.id, v._raw);
  for (const list of by_category_slug.values()) {
    for (const v of list) raw_by_id.set(v.id, v._raw);
  }

  return ordered
    .map((p) => raw_by_id.get(p.id))
    .filter((p): p is DbFeaturedProduct => Boolean(p))
    .map((p) => serialize_featured(payload, p));
}
