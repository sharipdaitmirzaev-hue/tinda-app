import type { QtyErrorCode } from "@/lib/quantity";

export type SerializedCartProduct = {
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
  availability: string;
  image_url: string | null;
  is_active: boolean;
};

export type SerializedCartItem = {
  product_id: string;
  qty: number;
  product: SerializedCartProduct;
  qty_error: QtyErrorCode;
  suggested_qty: number | null;
};

export type SerializedCart = {
  items: SerializedCartItem[];
  items_count: number;
  total_qty: number;
  is_ready_to_checkout: boolean;
};
