"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { ProductStatusBadges } from "@/components/catalog/product-status-badges";
import { QuantityStepper } from "@/components/catalog/quantity-stepper";
import { Toast } from "@/components/catalog/toast";
import {
  format_rub_price,
  useCatalogViewer,
} from "@/components/catalog/catalog-viewer-context";
import { useAddToServerCart } from "@/hooks/useServerCart";
import {
  AVAILABILITY_LABELS,
  SALES_STATUS_LABELS,
  type Availability,
  type SalesStatus,
} from "@/lib/catalog/constants";
import { check_qty, get_initial_qty } from "@/lib/quantity";

export type QuickViewProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: { id: string; name: string } | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  description: string | null;
  availability: string;
  availability_label?: string;
  sales_status?: string;
  sales_status_label?: string;
  can_add_to_cart?: boolean;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string | null;
  price?: { amount: number; currency: string; unit: string } | null;
  guest_hint?: string;
};

type Props = {
  product_id: string;
  on_close: () => void;
  /** Element to restore focus to after close. */
  return_focus_el?: HTMLElement | null;
  /** When true, product detail page link is shown. */
  has_product_page?: boolean;
};

const session_cache = new Map<string, QuickViewProduct>();

export function clearQuickViewCache() {
  session_cache.clear();
}

function get_focusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return [...nodes].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function CatalogQuickView({
  product_id,
  on_close,
  return_focus_el = null,
  has_product_page = true,
}: Props) {
  const viewer = useCatalogViewer();
  const approved = viewer === "approved";
  const guest = viewer === "guest";
  const title_id = useId();
  const dialog_ref = useRef<HTMLDivElement | null>(null);
  const close_btn_ref = useRef<HTMLButtonElement | null>(null);

  const [product, set_product] = useState<QuickViewProduct | null>(
    () => session_cache.get(product_id) ?? null,
  );
  const [loading, set_loading] = useState(!session_cache.has(product_id));
  const [error, set_error] = useState<string | null>(null);
  const [qty, set_qty] = useState(1);
  const [interest_qty, set_interest_qty] = useState("12");
  const [interest_comment, set_interest_comment] = useState("");
  const [interest_pending, set_interest_pending] = useState(false);
  const [interest_done, set_interest_done] = useState<string | null>(null);
  const [interest_error, set_interest_error] = useState<string | null>(null);
  const { add_with_qty, toast, pending } = useAddToServerCart();

  const load = useCallback(async () => {
    if (session_cache.has(product_id)) {
      const cached = session_cache.get(product_id)!;
      set_product(cached);
      set_qty(get_initial_qty(cached));
      set_loading(false);
      set_error(null);
      return;
    }
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/catalog/products/${product_id}`, {
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Товар не найден");
      }
      const next = data.product as QuickViewProduct;
      session_cache.set(product_id, next);
      set_product(next);
      set_qty(get_initial_qty(next));
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
      set_product(null);
    } finally {
      set_loading(false);
    }
  }, [product_id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Initial focus + restore on unmount
  useEffect(() => {
    const t = window.setTimeout(() => {
      close_btn_ref.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      return_focus_el?.focus?.();
    };
  }, [return_focus_el]);

  // Escape
  useEffect(() => {
    function on_key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        on_close();
      }
    }
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, [on_close]);

  function on_dialog_key_down(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialog_ref.current) return;
    const focusable = get_focusable(dialog_ref.current);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !dialog_ref.current.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const sales_status = product?.sales_status || "showcase";
  const can_cart = Boolean(approved && product?.can_add_to_cart);
  const quantity_product = product
    ? {
        units_per_package: product.units_per_package,
        min_order_qty: product.min_order_qty,
        allow_piece_sale: product.allow_piece_sale,
        availability: product.availability,
      }
    : null;
  const qty_check = quantity_product
    ? check_qty(quantity_product, qty)
    : { valid: false };

  async function on_add() {
    if (!product || !quantity_product || !can_cart || !qty_check.valid || pending) {
      return;
    }
    await add_with_qty(
      {
        product_id: product.id,
        ...quantity_product,
      },
      qty,
    );
  }

  async function on_interest_submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || !approved) return;
    set_interest_pending(true);
    set_interest_error(null);
    try {
      const requested_qty = interest_qty.trim()
        ? Number(interest_qty)
        : null;
      const res = await fetch(`/api/v1/client/products/${product.id}/interest`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_type:
            sales_status === "on_request" ? "price_request" : "interest",
          requested_qty,
          comment: interest_comment.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Не удалось отправить");
      }
      set_interest_done(
        data.message ||
          (data.already_registered
            ? "Ваш запрос по этому товару уже зарегистрирован"
            : "Запрос отправлен. Менеджер свяжется с вами"),
      );
    } catch (err) {
      set_interest_error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      set_interest_pending(false);
    }
  }

  const availability_label =
    product?.availability_label ??
    AVAILABILITY_LABELS[product?.availability as Availability] ??
    product?.availability ??
    "";
  const sales_label =
    product?.sales_status_label ??
    SALES_STATUS_LABELS[sales_status as SalesStatus] ??
    sales_status;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center md:items-center md:p-4"
      data-testid="catalog-quick-view"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="Закрыть быстрый просмотр"
        data-testid="catalog-quick-view-backdrop"
        onClick={on_close}
      />

      <div
        ref={dialog_ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title_id}
        tabIndex={-1}
        onKeyDown={on_dialog_key_down}
        className="relative z-[61] flex h-full w-full max-w-none flex-col overflow-hidden bg-white shadow-xl outline-none md:h-auto md:max-h-[90vh] md:max-w-[900px] md:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-medium text-slate-500">Быстрый просмотр</p>
          <button
            ref={close_btn_ref}
            type="button"
            onClick={on_close}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            aria-label="Закрыть"
            data-testid="catalog-quick-view-close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {loading ? (
            <div
              className="space-y-4"
              role="status"
              aria-live="polite"
              data-testid="catalog-quick-view-loading"
            >
              <div className="aspect-square max-h-80 w-full animate-pulse rounded-xl bg-slate-200" />
              <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
              <p className="text-sm text-slate-600">Загрузка товара…</p>
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              role="alert"
              data-testid="catalog-quick-view-error"
            >
              <p>{error}</p>
              <button
                type="button"
                className="mt-3 rounded-md bg-red-700 px-3 py-2 text-white"
                onClick={() => void load()}
              >
                Повторить
              </button>
            </div>
          ) : null}

          {!loading && !error && product ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <ProductImage
                  src={product.image_url}
                  alt={product.name}
                  className="aspect-square w-full bg-slate-50"
                  object_fit="contain"
                  priority
                />
              </div>

              <div className="space-y-3">
                <ProductStatusBadges product={product} />
                <h2
                  id={title_id}
                  className="text-xl font-semibold text-slate-900 md:text-2xl"
                >
                  {product.name}
                </h2>
                <p className="text-sm text-slate-600">
                  {product.brand || "Без бренда"}
                </p>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-slate-500">Артикул</dt>
                    <dd className="font-medium text-slate-900">{product.sku}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Категория</dt>
                    <dd className="font-medium text-slate-900">
                      {product.category?.name || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Объём</dt>
                    <dd className="font-medium text-slate-900">
                      {product.volume_text || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Упаковка</dt>
                    <dd className="font-medium text-slate-900">
                      {product.package_type || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">В упаковке</dt>
                    <dd className="font-medium text-slate-900">
                      {product.units_per_package} {product.sale_unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Наличие</dt>
                    <dd className="font-medium text-slate-900">
                      {availability_label}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Режим продажи</dt>
                    <dd className="font-medium text-slate-900">{sales_label}</dd>
                  </div>
                </dl>

                {guest || viewer === "pending" ? (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {product.guest_hint ||
                      "Войдите или зарегистрируйтесь, чтобы узнать условия поставки"}
                  </p>
                ) : null}

                {approved ? (
                  product.availability === "out_of_stock" ? (
                    <p className="text-sm font-medium text-red-700">
                      Нет в наличии
                    </p>
                  ) : sales_status === "orderable" && product.price ? (
                    <p className="text-xl font-semibold text-slate-900">
                      {format_rub_price(
                        product.price.amount,
                        product.price.unit,
                      )}
                    </p>
                  ) : sales_status === "on_request" ? (
                    <p className="text-sm font-medium text-slate-700">
                      Цена по запросу
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-slate-700">Витрина</p>
                  )
                ) : null}

                {product.description ? (
                  <p className="text-sm leading-relaxed text-slate-700">
                    {product.description}
                  </p>
                ) : null}

                {approved && can_cart && quantity_product ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                    <QuantityStepper
                      product={quantity_product}
                      qty={qty}
                      on_change={set_qty}
                    />
                    <p className="text-xs text-slate-500">
                      Единица заказа: {product.sale_unit}
                    </p>
                    <button
                      type="button"
                      disabled={pending || !qty_check.valid}
                      onClick={() => void on_add()}
                      className="min-h-11 w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      data-testid="quick-view-add-to-cart"
                    >
                      {pending ? "Добавляем…" : "В корзину"}
                    </button>
                    {toast ? (
                      <p
                        className="text-sm text-teal-800"
                        role="status"
                        data-testid="quick-view-cart-ok"
                      >
                        {toast}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {approved && !can_cart ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                    {interest_done ? (
                      <p className="text-sm text-teal-800" role="status">
                        {interest_done}
                      </p>
                    ) : (
                      <form className="space-y-3" onSubmit={on_interest_submit}>
                        <p className="text-sm font-medium text-slate-900">
                          {sales_status === "on_request"
                            ? "Запросить цену"
                            : "Интересует товар"}
                        </p>
                        <label className="block text-sm text-slate-700">
                          Желаемое количество
                          <input
                            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                            value={interest_qty}
                            onChange={(e) => set_interest_qty(e.target.value)}
                            inputMode="numeric"
                          />
                        </label>
                        <label className="block text-sm text-slate-700">
                          Комментарий (необязательно)
                          <textarea
                            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                            rows={3}
                            value={interest_comment}
                            onChange={(e) =>
                              set_interest_comment(e.target.value)
                            }
                          />
                        </label>
                        {interest_error ? (
                          <p className="text-sm text-red-700">{interest_error}</p>
                        ) : null}
                        <button
                          type="submit"
                          disabled={interest_pending}
                          className="min-h-11 w-full rounded-md bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:bg-slate-300"
                        >
                          {interest_pending ? "Отправка…" : "Отправить запрос"}
                        </button>
                      </form>
                    )}
                  </div>
                ) : null}

                {has_product_page ? (
                  <Link
                    href={`/catalog/products/${product.id}`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                  >
                    Открыть страницу товара
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Toast message={toast} />
    </div>
  );
}

export default CatalogQuickView;
