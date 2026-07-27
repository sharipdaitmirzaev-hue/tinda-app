export const SALE_UNITS = [
  "шт",
  "упаковка",
  "коробка",
  "блок",
  "кг",
] as const;

export type SaleUnit = (typeof SALE_UNITS)[number];

export const AVAILABILITY_VALUES = [
  "in_stock",
  "on_order",
  "out_of_stock",
] as const;

export type Availability = (typeof AVAILABILITY_VALUES)[number];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: "В наличии",
  on_order: "Под заказ",
  out_of_stock: "Временно нет",
};

export const SALES_STATUS_VALUES = [
  "showcase",
  "on_request",
  "orderable",
] as const;

export type SalesStatus = (typeof SALES_STATUS_VALUES)[number];

export const SALES_STATUS_LABELS: Record<SalesStatus, string> = {
  showcase: "Витрина",
  on_request: "Цена по запросу",
  orderable: "Доступен для заказа",
};

export const INTEREST_REQUEST_TYPES = ["interest", "price_request"] as const;
export type InterestRequestType = (typeof INTEREST_REQUEST_TYPES)[number];

export const INTEREST_REQUEST_TYPE_LABELS: Record<InterestRequestType, string> =
  {
    interest: "Интересует товар",
    price_request: "Запрос цены",
  };

export const INTEREST_REQUEST_STATUSES = [
  "new",
  "contacted",
  "closed",
] as const;
export type InterestRequestStatus = (typeof INTEREST_REQUEST_STATUSES)[number];

export const INTEREST_REQUEST_STATUS_LABELS: Record<
  InterestRequestStatus,
  string
> = {
  new: "Новый",
  contacted: "Связались",
  closed: "Закрыт",
};

export const PRODUCT_SORT_OPTIONS = [
  "name_asc",
  "name_desc",
  "created_at_desc",
  "created_at_asc",
  "is_new_desc",
  "is_hit_desc",
] as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];

export const CATALOG_PAGE_SIZE_OPTIONS = [12, 24] as const;

/** Server-side gate: can this product enter the cart / checkout. */
export function is_product_orderable_for_cart(product: {
  is_active: boolean;
  sales_status: string;
  price_amount: unknown;
  availability: string;
  category_is_active?: boolean | null;
}): boolean {
  if (!product.is_active) return false;
  if (product.category_is_active === false) return false;
  if (product.sales_status !== "orderable") return false;
  if (product.availability === "out_of_stock") return false;
  if (product.price_amount === null || product.price_amount === undefined) {
    return false;
  }
  const amount = Number(product.price_amount);
  return Number.isFinite(amount) && amount > 0;
}
