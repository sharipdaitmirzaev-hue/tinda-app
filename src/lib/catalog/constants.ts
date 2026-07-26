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

export const PRODUCT_SORT_OPTIONS = [
  "name_asc",
  "name_desc",
  "created_at_desc",
  "created_at_asc",
] as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];
