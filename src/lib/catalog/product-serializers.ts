import type { Decimal } from "@prisma/client/runtime/library";
import { money_to_number } from "@/lib/money";
import {
  AVAILABILITY_LABELS,
  SALES_STATUS_LABELS,
  type SalesStatus,
  is_product_orderable_for_cart,
} from "@/lib/catalog/constants";

export type ProductPricePayload = {
  amount: number;
  currency: "RUB";
  unit: string;
};

export type ProductRowForSerialize = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category_id: string;
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
  price_amount: Decimal | string | number | null;
  price_currency: string;
  created_at: Date;
  updated_at: Date;
  category?: { id: string; name: string; is_active?: boolean } | null;
};

const FINANCIAL_FIELD_DENYLIST = [
  "price",
  "price_amount",
  "price_currency",
  "purchase_price",
  "cost_price",
  "supplier_price",
  "margin",
  "unit_price",
  "line_total",
  "subtotal",
  "total",
  "delivery_total",
  "amount",
] as const;

function sales_status_label(status: string): string {
  return (
    SALES_STATUS_LABELS[status as SalesStatus] ?? status
  );
}

function has_positive_price(product: ProductRowForSerialize): boolean {
  if (product.price_amount === null || product.price_amount === undefined) {
    return false;
  }
  return Number(product.price_amount) > 0;
}

function base_public_fields(product: ProductRowForSerialize) {
  const availability = product.availability as keyof typeof AVAILABILITY_LABELS;
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    category_id: product.category_id,
    category_name: product.category?.name ?? null,
    volume_text: product.volume_text,
    package_type: product.package_type,
    units_per_package: product.units_per_package,
    sale_unit: product.sale_unit,
    min_order_qty: product.min_order_qty,
    allow_piece_sale: product.allow_piece_sale,
    description: product.description,
    availability: product.availability,
    availability_label:
      AVAILABILITY_LABELS[availability] ?? product.availability,
    sales_status: product.sales_status,
    sales_status_label: sales_status_label(product.sales_status),
    is_promo: product.is_promo,
    is_new: product.is_new,
    is_hit: product.is_hit,
    image_url: product.image_url,
    is_active: product.is_active,
    can_add_to_cart: is_product_orderable_for_cart({
      is_active: product.is_active,
      sales_status: product.sales_status,
      price_amount: product.price_amount,
      availability: product.availability,
      category_is_active: product.category?.is_active,
    }),
    created_at: product.created_at.toISOString(),
    updated_at: product.updated_at.toISOString(),
    step: product.allow_piece_sale ? 1 : product.units_per_package,
  };
}

function build_price(product: ProductRowForSerialize): ProductPricePayload | null {
  if (!has_positive_price(product)) return null;
  return {
    amount: money_to_number(product.price_amount as Decimal | string | number),
    currency: "RUB",
    unit: product.sale_unit,
  };
}

/** Public catalog payload — must not contain any money / cost fields. */
export function serialize_public_product(product: ProductRowForSerialize) {
  return base_public_fields(product);
}

/**
 * Approved client catalog payload.
 * Price only when sales_status=orderable and price_amount > 0.
 */
export function serialize_approved_client_product(
  product: ProductRowForSerialize,
) {
  const base = base_public_fields(product);
  const show_price =
    product.sales_status === "orderable" && has_positive_price(product);
  return {
    ...base,
    ...(show_price ? { price: build_price(product) } : {}),
  };
}

/** Staff catalog payload — list/edit fields including nullable price. */
export function serialize_staff_product(product: ProductRowForSerialize) {
  const price = build_price(product);
  return {
    ...base_public_fields(product),
    ...(price ? { price } : {}),
    price_amount: has_positive_price(product)
      ? money_to_number(product.price_amount as Decimal | string | number)
      : null,
    price_currency: product.price_currency || "RUB",
  };
}

export function serialize_public_product_detail(product: ProductRowForSerialize) {
  const base = serialize_public_product(product);
  return {
    id: base.id,
    sku: base.sku,
    name: base.name,
    brand: base.brand,
    category: product.category
      ? { id: product.category.id, name: product.category.name }
      : null,
    volume_text: base.volume_text,
    package_type: base.package_type,
    units_per_package: base.units_per_package,
    sale_unit: base.sale_unit,
    min_order_qty: base.min_order_qty,
    allow_piece_sale: base.allow_piece_sale,
    description: base.description,
    availability: base.availability,
    availability_label: base.availability_label,
    sales_status: base.sales_status,
    sales_status_label: base.sales_status_label,
    can_add_to_cart: base.can_add_to_cart,
    is_promo: base.is_promo,
    is_new: base.is_new,
    is_hit: base.is_hit,
    image_url: base.image_url,
    guest_hint:
      "Войдите или зарегистрируйтесь, чтобы узнать условия поставки",
  };
}

export function serialize_approved_client_product_detail(
  product: ProductRowForSerialize,
) {
  const base = serialize_public_product_detail(product);
  const { guest_hint: _ignored, ...rest } = base;
  void _ignored;
  const show_price =
    product.sales_status === "orderable" && has_positive_price(product);
  return {
    ...rest,
    ...(show_price ? { price: build_price(product) } : {}),
  };
}

/** Runtime guard: public serializer output must not leak financial keys. */
export function assert_public_product_has_no_price(payload: unknown): void {
  const keys = collect_financial_keys(payload);
  if (keys.length > 0) {
    throw new Error(
      `Public product serializer leaked financial keys: ${keys.join(", ")}`,
    );
  }
}

export function collect_financial_keys(
  value: unknown,
  path = "",
): string[] {
  const found: string[] = [];
  if (value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collect_financial_keys(item, `${path}[${index}]`));
    });
    return found;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const full = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (
        (FINANCIAL_FIELD_DENYLIST as readonly string[]).includes(lower) ||
        lower.includes("price") ||
        lower.includes("margin") ||
        lower === "cost" ||
        lower.endsWith("_cost")
      ) {
        found.push(full);
      }
      found.push(...collect_financial_keys(nested, full));
    }
  }
  return found;
}
