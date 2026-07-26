"use client";

import { check_qty, get_order_step, suggest_qty } from "@/lib/quantity";

type Props = {
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  qty: number;
  on_change: (qty: number) => void;
};

export function QuantityStepper({
  units_per_package,
  min_order_qty,
  allow_piece_sale,
  availability,
  qty,
  on_change,
}: Props) {
  const product = {
    units_per_package,
    min_order_qty,
    allow_piece_sale,
    availability,
  };
  const step = get_order_step(product);
  const check = check_qty(product, qty);

  function set_valid(next: number) {
    const suggested = suggest_qty(product, next);
    on_change(Math.max(suggested, min_order_qty));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-10 w-10 rounded-md border border-slate-300 text-lg disabled:opacity-40"
          disabled={qty <= min_order_qty}
          onClick={() => set_valid(qty - step)}
          aria-label="Уменьшить количество"
        >
          −
        </button>
        <input
          type="number"
          value={qty}
          min={min_order_qty}
          step={step}
          onChange={(e) => on_change(Number(e.target.value))}
          onBlur={() => {
            if (!check.valid) on_change(check.suggested_qty);
          }}
          className="h-10 w-24 rounded-md border border-slate-300 px-2 text-center"
        />
        <button
          type="button"
          className="h-10 w-10 rounded-md border border-slate-300 text-lg"
          onClick={() => set_valid(qty + step)}
          aria-label="Увеличить количество"
        >
          +
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Шаг: {step}. Минимум: {min_order_qty}.
        {allow_piece_sale ? " Можно поштучно." : " Кратность упаковки."}
      </p>
      {!check.valid && check.message ? (
        <div className="space-y-1">
          <p className="text-sm text-red-700">{check.message}</p>
          <button
            type="button"
            className="text-sm text-teal-800 underline"
            onClick={() => on_change(check.suggested_qty)}
          >
            Поставить {check.suggested_qty}
          </button>
        </div>
      ) : null}
    </div>
  );
}
