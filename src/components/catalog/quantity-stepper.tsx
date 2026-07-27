"use client";

import {
  check_qty,
  decrease_qty,
  get_min_allowed_qty,
  get_order_step,
  increase_qty,
  type QuantityProduct,
} from "@/lib/quantity";

type Props = {
  product: QuantityProduct;
  qty: number;
  on_change: (qty: number) => void;
};

export function QuantityStepper({ product, qty, on_change }: Props) {
  const step = get_order_step(product);
  const min_allowed_qty = get_min_allowed_qty(product);
  const check = check_qty(product, qty);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-11 w-11 rounded-md border border-slate-300 text-lg disabled:opacity-40"
          disabled={qty <= min_allowed_qty}
          onClick={() => on_change(decrease_qty(product, qty))}
          aria-label="Уменьшить количество"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(qty) ? qty : ""}
          min={min_allowed_qty}
          step={step}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "") {
              on_change(Number.NaN);
              return;
            }
            on_change(Number(value));
          }}
          aria-label="Количество"
          className="h-11 w-28 rounded-md border border-slate-300 px-2 text-center"
        />
        <button
          type="button"
          className="h-11 w-11 rounded-md border border-slate-300 text-lg"
          onClick={() => on_change(increase_qty(product, qty))}
          aria-label="Увеличить количество"
        >
          +
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Заказ кратно {step}. Минимальное количество заказа: {product.min_order_qty}.
        {product.allow_piece_sale
          ? " Доступна продажа поштучно."
          : " Количество должно соответствовать упаковке."}
      </p>

      {!check.valid && check.message ? (
        <div className="space-y-2 rounded-md bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{check.message}</p>
          {check.qty_error === "not_multiple" ||
          check.qty_error === "below_min" ||
          check.qty_error === "not_integer" ||
          check.qty_error === "not_positive" ? (
            <button
              type="button"
              className="rounded-md bg-white px-3 py-1.5 text-sm text-teal-900 ring-1 ring-teal-800/20"
              onClick={() => on_change(check.suggested_qty)}
            >
              Исправить на {check.suggested_qty}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
