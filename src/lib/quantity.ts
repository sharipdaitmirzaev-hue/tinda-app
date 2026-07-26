export type QuantityProduct = {
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  is_active?: boolean;
};

export type QuantityCheck = {
  valid: boolean;
  step: number;
  suggested_qty: number;
  qty_error: "not_multiple" | "below_min" | "out_of_stock" | "inactive" | null;
  message: string | null;
};

export function get_order_step(product: QuantityProduct): number {
  return product.allow_piece_sale ? 1 : Math.max(1, product.units_per_package);
}

export function suggest_qty(product: QuantityProduct, qty: number): number {
  const step = get_order_step(product);
  const min = Math.max(1, product.min_order_qty);
  const safe_qty = Number.isFinite(qty) ? qty : min;
  let suggested = Math.ceil(safe_qty / step) * step;
  if (suggested < min) {
    suggested = Math.ceil(min / step) * step;
  }
  return suggested;
}

export function check_qty(product: QuantityProduct, qty: number): QuantityCheck {
  const step = get_order_step(product);
  const suggested_qty = suggest_qty(product, qty);

  if (product.is_active === false) {
    return {
      valid: false,
      step,
      suggested_qty,
      qty_error: "inactive",
      message: "Товар недоступен",
    };
  }

  if (product.availability === "out_of_stock") {
    return {
      valid: false,
      step,
      suggested_qty,
      qty_error: "out_of_stock",
      message: "Товара временно нет",
    };
  }

  if (!Number.isInteger(qty) || qty < product.min_order_qty) {
    return {
      valid: false,
      step,
      suggested_qty,
      qty_error: "below_min",
      message: `Количество должно быть кратно ${step}. Ближайшее значение: ${suggested_qty}.`,
    };
  }

  if (qty % step !== 0) {
    return {
      valid: false,
      step,
      suggested_qty,
      qty_error: "not_multiple",
      message: `Количество должно быть кратно ${step}. Ближайшее значение: ${suggested_qty}.`,
    };
  }

  return {
    valid: true,
    step,
    suggested_qty: qty,
    qty_error: null,
    message: null,
  };
}

export function can_add_to_cart(product: QuantityProduct): boolean {
  if (product.is_active === false) return false;
  return product.availability !== "out_of_stock";
}
