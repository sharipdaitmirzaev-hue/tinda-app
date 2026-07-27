export type QuantityProduct = {
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability?: string;
  is_active?: boolean;
};

export type QtyErrorCode =
  | "not_integer"
  | "not_positive"
  | "below_min"
  | "not_multiple"
  | "out_of_stock"
  | "inactive"
  | null;

export type QuantityCheck = {
  valid: boolean;
  step: number;
  min_allowed_qty: number;
  suggested_qty: number;
  qty_error: QtyErrorCode;
  message: string | null;
};

/** Step for order quantity. */
export function get_order_step(product: QuantityProduct): number {
  if (product.allow_piece_sale) {
    return 1;
  }
  return Math.max(1, Math.floor(product.units_per_package) || 1);
}

/** Smallest allowed qty: >= min_order_qty and multiple of step. */
export function get_min_allowed_qty(product: QuantityProduct): number {
  const step = get_order_step(product);
  const min = Math.max(1, Math.floor(product.min_order_qty) || 1);
  return Math.ceil(min / step) * step;
}

/** Initial qty for UI and first add-to-cart. */
export function get_initial_qty(product: QuantityProduct): number {
  return get_min_allowed_qty(product);
}

/**
 * Round qty up to nearest allowed value, never below min_allowed_qty.
 */
export function suggest_qty(product: QuantityProduct, qty: number): number {
  const step = get_order_step(product);
  const min_allowed_qty = get_min_allowed_qty(product);

  if (!Number.isFinite(qty)) {
    return min_allowed_qty;
  }

  let suggested = Math.ceil(qty / step) * step;
  if (suggested < min_allowed_qty) {
    suggested = min_allowed_qty;
  }
  return suggested;
}

export function check_qty(product: QuantityProduct, qty: number): QuantityCheck {
  const step = get_order_step(product);
  const min_allowed_qty = get_min_allowed_qty(product);
  const suggested_qty = suggest_qty(product, qty);

  if (product.is_active === false) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "inactive",
      message: "Товар недоступен",
    };
  }

  if (product.availability === "out_of_stock") {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "out_of_stock",
      message: "Товара временно нет",
    };
  }

  if (typeof qty !== "number" || Number.isNaN(qty) || !Number.isFinite(qty)) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "not_integer",
      message: "Введите целое количество",
    };
  }

  if (!Number.isInteger(qty)) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "not_integer",
      message: "Введите целое количество",
    };
  }

  if (qty <= 0) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "not_positive",
      message: `Минимальное количество заказа: ${product.min_order_qty}.`,
    };
  }

  if (qty < product.min_order_qty || qty < min_allowed_qty) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "below_min",
      message: `Минимальное количество заказа: ${product.min_order_qty}.`,
    };
  }

  if (qty % step !== 0) {
    return {
      valid: false,
      step,
      min_allowed_qty,
      suggested_qty,
      qty_error: "not_multiple",
      message: `Количество должно быть кратно ${step}. Ближайшее значение: ${suggested_qty}.`,
    };
  }

  return {
    valid: true,
    step,
    min_allowed_qty,
    suggested_qty: qty,
    qty_error: null,
    message: null,
  };
}

export function can_add_to_cart(product: QuantityProduct): boolean {
  if (product.is_active === false) return false;
  return product.availability !== "out_of_stock";
}

export function increase_qty(product: QuantityProduct, qty: number): number {
  const step = get_order_step(product);
  const base = Number.isInteger(qty) ? qty : get_initial_qty(product);
  return base + step;
}

export function decrease_qty(product: QuantityProduct, qty: number): number {
  const step = get_order_step(product);
  const min_allowed_qty = get_min_allowed_qty(product);
  const base = Number.isInteger(qty) ? qty : get_initial_qty(product);
  return Math.max(min_allowed_qty, base - step);
}

/** Normalize qty for cart merge: ensure valid allowed quantity. */
export function normalize_cart_qty(product: QuantityProduct, qty: number): number | null {
  if (!can_add_to_cart(product)) {
    return null;
  }
  const check = check_qty(product, qty);
  if (check.valid) {
    return qty;
  }
  return check.suggested_qty;
}
