"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Toast } from "@/components/catalog/toast";
import {
  clear_server_cart,
  refresh_server_cart,
  remove_server_cart_item,
  update_server_cart_item,
  useServerCart,
} from "@/hooks/useServerCart";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/catalog/constants";
import {
  check_qty,
  decrease_qty,
  get_order_step,
  increase_qty,
} from "@/lib/quantity";
import type { SerializedCartItem } from "@/lib/cart/types";

function qty_error_message(item: SerializedCartItem): string | null {
  if (!item.qty_error) return null;
  if (item.qty_error === "out_of_stock") return "Товара временно нет";
  if (item.qty_error === "inactive") return "Товар недоступен";

  const check = check_qty(
    {
      units_per_package: item.product.units_per_package,
      min_order_qty: item.product.min_order_qty,
      allow_piece_sale: item.product.allow_piece_sale,
      availability: item.product.availability,
      is_active: item.product.is_active,
    },
    item.qty,
  );
  return check.message;
}

function CartItemRow({
  item,
  busy,
  on_change_qty,
  on_remove,
}: {
  item: SerializedCartItem;
  busy: boolean;
  on_change_qty: (product_id: string, qty: number) => Promise<void>;
  on_remove: (product_id: string) => Promise<void>;
}) {
  const [draft_qty, set_draft_qty] = useState(String(item.qty));
  const [confirm_remove, set_confirm_remove] = useState(false);
  const [row_busy, set_row_busy] = useState(false);

  useEffect(() => {
    set_draft_qty(String(item.qty));
  }, [item.qty]);

  const product = item.product;
  const quantity_product = {
    units_per_package: product.units_per_package,
    min_order_qty: product.min_order_qty,
    allow_piece_sale: product.allow_piece_sale,
    availability: product.availability,
    is_active: product.is_active,
  };
  const step = get_order_step(quantity_product);
  const error_message = qty_error_message(item);
  const availability_label =
    AVAILABILITY_LABELS[product.availability as Availability] ??
    product.availability;
  const qty_locked =
    item.qty_error === "out_of_stock" || item.qty_error === "inactive";
  const busy_now = busy || row_busy;
  const qty_disabled = busy_now || qty_locked;

  async function apply_qty(next: number) {
    if (qty_disabled) return;
    set_row_busy(true);
    try {
      await on_change_qty(item.product_id, next);
    } finally {
      set_row_busy(false);
    }
  }

  async function commit_draft() {
    const parsed = Number(draft_qty);
    if (!Number.isFinite(parsed) || parsed === item.qty) {
      set_draft_qty(String(item.qty));
      return;
    }
    await apply_qty(parsed);
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="h-24 w-24 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/catalog/products/${product.id}`}
            className="text-base font-semibold text-teal-900 underline-offset-2 hover:underline"
          >
            {product.name}
          </Link>
          <p className="text-sm text-slate-600">{product.brand || "Без бренда"}</p>
          <p className="text-xs text-slate-500">Артикул: {product.sku}</p>
          <p className="text-xs text-slate-600">
            {[product.volume_text, product.package_type]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
          <p className="text-xs text-slate-600">
            {product.units_per_package} шт. в упаковке · {product.sale_unit}
          </p>
          <p
            className={`text-xs font-medium ${
              product.availability === "out_of_stock"
                ? "text-red-700"
                : product.availability === "on_order"
                  ? "text-amber-700"
                  : "text-teal-800"
            }`}
          >
            {availability_label}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={qty_disabled}
            onClick={() => apply_qty(decrease_qty(quantity_product, item.qty))}
            className="h-10 w-10 rounded-md border border-slate-300 text-lg disabled:opacity-40"
            aria-label="Уменьшить количество"
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            value={draft_qty}
            disabled={qty_disabled}
            step={step}
            onChange={(e) => set_draft_qty(e.target.value)}
            onBlur={() => void commit_draft()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="h-10 w-24 rounded-md border border-slate-300 px-2 text-center disabled:bg-slate-50"
            aria-label="Количество"
          />
          <button
            type="button"
            disabled={qty_disabled}
            onClick={() => apply_qty(increase_qty(quantity_product, item.qty))}
            className="h-10 w-10 rounded-md border border-slate-300 text-lg disabled:opacity-40"
            aria-label="Увеличить количество"
          >
            +
          </button>
          <span className="text-xs text-slate-500">кратно {step}</span>
        </div>

        {error_message ? (
          <div className="space-y-2 rounded-md bg-red-50 px-3 py-2">
            <p className="text-sm text-red-700">{error_message}</p>
            {item.suggested_qty !== null ? (
              <button
                type="button"
                disabled={qty_disabled}
                onClick={() => apply_qty(item.suggested_qty!)}
                className="rounded-md bg-white px-3 py-1.5 text-sm text-teal-900 ring-1 ring-teal-800/20 disabled:opacity-40"
              >
                Исправить на {item.suggested_qty}
              </button>
            ) : null}
          </div>
        ) : null}

        {!confirm_remove ? (
          <button
            type="button"
            disabled={busy_now}
            onClick={() => set_confirm_remove(true)}
            className="text-sm text-red-700 underline disabled:opacity-40"
          >
            Удалить позицию
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm">
            <span className="text-red-800">Удалить эту позицию?</span>
            <button
              type="button"
              disabled={busy_now}
              onClick={async () => {
                set_row_busy(true);
                try {
                  await on_remove(item.product_id);
                } finally {
                  set_row_busy(false);
                  set_confirm_remove(false);
                }
              }}
              className="rounded-md bg-red-700 px-3 py-1.5 text-white disabled:opacity-40"
            >
              Удалить
            </button>
            <button
              type="button"
              disabled={busy_now}
              onClick={() => set_confirm_remove(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Отмена
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function CartPageClient() {
  const { cart, loading, error, mutating } = useServerCart();
  const [toast, set_toast] = useState<string | null>(null);
  const [confirm_clear, set_confirm_clear] = useState(false);
  const [action_error, set_action_error] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => set_toast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handle_change_qty(product_id: string, qty: number) {
    set_action_error(null);
    try {
      await update_server_cart_item(product_id, qty);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Не удалось изменить количество";
      set_action_error(message);
      set_toast(message);
      await refresh_server_cart().catch(() => undefined);
    }
  }

  async function handle_remove(product_id: string) {
    set_action_error(null);
    try {
      await remove_server_cart_item(product_id);
      set_toast("Позиция удалена");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Не удалось удалить позицию";
      set_action_error(message);
      set_toast(message);
    }
  }

  async function handle_clear() {
    set_action_error(null);
    try {
      await clear_server_cart();
      set_confirm_clear(false);
      set_toast("Корзина очищена");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Не удалось очистить корзину";
      set_action_error(message);
      set_toast(message);
    }
  }

  if (loading && !cart) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  if (error && !cart) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void refresh_server_cart()}
          className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-white"
        >
          Повторить
        </button>
      </div>
    );
  }

  const items = cart?.items ?? [];
  const empty = items.length === 0;

  if (empty) {
    return (
      <>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Корзина пуста</h1>
          <p className="mt-2 text-slate-600">Добавьте товары из каталога</p>
          <Link
            href="/catalog"
            className="mt-6 inline-block rounded-md bg-teal-700 px-4 py-2.5 text-sm text-white hover:bg-teal-800"
          >
            Перейти в каталог
          </Link>
        </div>
        <Toast message={toast} />
      </>
    );
  }

  const checkout_ready = Boolean(cart?.is_ready_to_checkout);
  const has_errors = items.some((item) => item.qty_error !== null);

  return (
    <>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Корзина</h1>

        {action_error || error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {action_error || error}
            <button
              type="button"
              onClick={() => void refresh_server_cart()}
              className="ml-3 underline"
            >
              Повторить
            </button>
          </div>
        ) : null}

        <div className="space-y-3">
          {items.map((item) => (
            <CartItemRow
              key={item.product_id}
              item={item}
              busy={mutating}
              on_change_qty={handle_change_qty}
              on_remove={handle_remove}
            />
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Итого</h2>
          <dl className="mt-3 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between">
              <dt>Товарных позиций</dt>
              <dd>{cart?.items_count ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Всего единиц</dt>
              <dd>{cart?.total_qty ?? 0}</dd>
            </div>
          </dl>

          {has_errors ? (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Исправьте или удалите позиции с ошибками, чтобы оформить заказ.
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            {checkout_ready ? (
              <Link
                href="/checkout"
                className="rounded-md bg-teal-700 px-4 py-3 text-center text-sm font-medium text-white hover:bg-teal-800"
              >
                Оформить заказ
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-md bg-slate-300 px-4 py-3 text-sm font-medium text-white"
              >
                Оформить заказ
              </button>
            )}
            <Link
              href="/catalog"
              className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm text-slate-800"
            >
              Продолжить покупки
            </Link>
            {!confirm_clear ? (
              <button
                type="button"
                disabled={mutating}
                onClick={() => set_confirm_clear(true)}
                className="rounded-md border border-red-200 px-4 py-3 text-sm text-red-700 disabled:opacity-40"
              >
                Очистить корзину
              </button>
            ) : (
              <div className="space-y-2 rounded-md bg-red-50 px-3 py-3 text-sm">
                <p className="text-red-800">Удалить все товары из корзины?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => void handle_clear()}
                    className="rounded-md bg-red-700 px-3 py-2 text-white disabled:opacity-40"
                  >
                    Очистить
                  </button>
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => set_confirm_clear(false)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-40"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      <Toast message={toast} />
    </>
  );
}
