"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  UI_CANCEL,
  UI_FIND_PRODUCTS_ERROR,
  UI_GENERIC_ERROR,
  UI_INVALID_QTY,
  UI_LOAD_ERROR,
  UI_LOAD_ORDER_ERROR,
  UI_ORDER_NEEDS_ITEMS,
  UI_PRODUCT_ALREADY_IN_ORDER,
  UI_SAVE,
  UI_SAVE_ORDER_ERROR,
  UI_SAVING,
} from "@/lib/i18n/ui-copy";
import {
  check_qty,
  decrease_qty,
  get_initial_qty,
  get_order_step,
  increase_qty,
  type QuantityProduct,
} from "@/lib/quantity";
import { today_date_key } from "@/lib/dates";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validators/orders";

type EditItem = {
  product_id: string;
  product_name: string;
  product_sku: string;
  qty: number;
  quantity: QuantityProduct;
};

type ProductHit = {
  id: string;
  sku: string;
  name: string;
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  is_active: boolean;
};

export function StaffOrderEdit({ order_id }: { order_id: string }) {
  const router = useRouter();
  const min_date = today_date_key();
  const [loading, set_loading] = useState(true);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const [address, set_address] = useState("");
  const [desired_delivery_date, set_desired_delivery_date] = useState(min_date);
  const [contact_name, set_contact_name] = useState("");
  const [contact_phone, set_contact_phone] = useState("");
  const [payment_method, set_payment_method] =
    useState<PaymentMethod>("bank_transfer");
  const [is_urgent, set_is_urgent] = useState(false);
  const [client_comment, set_client_comment] = useState("");
  const [manager_comment, set_manager_comment] = useState("");
  const [items, set_items] = useState<EditItem[]>([]);
  const [search_q, set_search_q] = useState("");
  const [search_hits, set_search_hits] = useState<ProductHit[]>([]);

  async function load() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/orders/${order_id}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? UI_LOAD_ORDER_ERROR);
      }
      const order = data.order;
      if (!order.can_edit) {
        throw new Error("Статус заказа уже изменён. Обновите страницу");
      }
      set_address(order.address);
      set_desired_delivery_date(order.desired_delivery_date);
      set_contact_name(order.contact_name);
      set_contact_phone(order.contact_phone);
      set_payment_method(order.payment_method);
      set_is_urgent(order.is_urgent);
      set_client_comment(order.client_comment ?? "");
      set_manager_comment(order.manager_comment ?? "");

      const next_items: EditItem[] = [];
      for (const item of order.items as Array<{
        product_id: string | null;
        product_name: string;
        product_sku: string;
        qty: number;
      }>) {
        if (!item.product_id) continue;
        const product_response = await fetch(
          `/api/v1/staff/products/${item.product_id}`,
        );
        if (!product_response.ok) continue;
        const product_data = await product_response.json();
        const product = product_data.product as ProductHit;
        next_items.push({
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          qty: item.qty,
          quantity: {
            units_per_package: product.units_per_package,
            min_order_qty: product.min_order_qty,
            allow_piece_sale: product.allow_piece_sale,
            availability: product.availability,
            is_active: product.is_active,
          },
        });
      }
      set_items(next_items);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order_id]);

  async function search_products() {
    if (!search_q.trim()) {
      set_search_hits([]);
      return;
    }
    const params = new URLSearchParams({
      q: search_q.trim(),
      page: "1",
      page_size: "10",
      is_active: "true",
    });
    const response = await fetch(`/api/v1/staff/products?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      set_error(data?.error?.message ?? UI_FIND_PRODUCTS_ERROR);
      return;
    }
    set_search_hits(data.items ?? []);
  }

  function add_product(product: ProductHit) {
    if (items.some((item) => item.product_id === product.id)) {
      set_error(UI_PRODUCT_ALREADY_IN_ORDER);
      return;
    }
    const quantity: QuantityProduct = {
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
      is_active: product.is_active,
    };
    set_items((current) => [
      ...current,
      {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        qty: get_initial_qty(quantity),
        quantity,
      },
    ]);
    set_search_hits([]);
    set_search_q("");
    set_error(null);
  }

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (items.length === 0) {
      set_error(UI_ORDER_NEEDS_ITEMS);
      return;
    }
    for (const item of items) {
      const check = check_qty(item.quantity, item.qty);
      if (!check.valid) {
        set_error(
          `${item.product_name}: ${check.message ?? UI_INVALID_QTY}`,
        );
        return;
      }
    }

    set_saving(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/orders/${order_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          desired_delivery_date,
          contact_name,
          contact_phone,
          payment_method,
          is_urgent,
          client_comment: client_comment.trim() ? client_comment.trim() : null,
          manager_comment: manager_comment.trim()
            ? manager_comment.trim()
            : null,
          items: items.map((item) => ({
            product_id: item.product_id,
            qty: item.qty,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? UI_SAVE_ORDER_ERROR);
      }
      router.replace(`/staff/orders/${order_id}`);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
      set_saving(false);
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-slate-200" />;
  }

  return (
    <form onSubmit={on_submit} className="space-y-4">
      <div>
        <Link
          href={`/staff/orders/${order_id}`}
          className="text-sm text-teal-800 underline"
        >
          ← К заказу
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Редактирование заказа</h1>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <label className="block text-sm">
            <span className="mb-1 block">Адрес</span>
            <textarea
              required
              rows={3}
              value={address}
              disabled={saving}
              onChange={(e) => set_address(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Желаемая дата доставки</span>
            <input
              type="date"
              required
              value={desired_delivery_date}
              disabled={saving}
              onChange={(e) => set_desired_delivery_date(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Контактное лицо</span>
            <input
              required
              value={contact_name}
              disabled={saving}
              onChange={(e) => set_contact_name(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Телефон</span>
            <input
              required
              value={contact_phone}
              disabled={saving}
              onChange={(e) => set_contact_phone(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <fieldset className="space-y-2 text-sm" disabled={saving}>
            <legend className="mb-1 font-medium">Способ оплаты</legend>
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={payment_method === method}
                  onChange={() => set_payment_method(method)}
                />
                {PAYMENT_METHOD_LABELS[method]}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={is_urgent}
              disabled={saving}
              onChange={(e) => set_is_urgent(e.target.checked)}
            />
            Срочный заказ
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Комментарий клиента</span>
            <textarea
              rows={2}
              value={client_comment}
              disabled={saving}
              onChange={(e) => set_client_comment(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Внутренний комментарий</span>
            <textarea
              rows={2}
              value={manager_comment}
              disabled={saving}
              onChange={(e) => set_manager_comment(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </section>

        <section className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Состав</h2>
          <div className="flex gap-2">
            <input
              value={search_q}
              disabled={saving}
              onChange={(e) => set_search_q(e.target.value)}
              placeholder="Найти товар"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void search_products()}
              className="rounded-md border px-3 py-2 text-sm"
            >
              Найти
            </button>
          </div>
          {search_hits.length > 0 ? (
            <ul className="space-y-2 rounded-md border p-2 text-sm">
              {search_hits.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {product.name}{" "}
                    <span className="text-slate-500">({product.sku})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => add_product(product)}
                    className="rounded-md bg-teal-700 px-2 py-1 text-xs text-white"
                  >
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <ul className="space-y-3">
            {items.map((item) => {
              const step = get_order_step(item.quantity);
              const check = check_qty(item.quantity, item.qty);
              return (
                <li
                  key={item.product_id}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.product_name}</p>
                      <p className="text-xs text-slate-500">{item.product_sku}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        set_items((current) =>
                          current.filter(
                            (row) => row.product_id !== item.product_id,
                          ),
                        )
                      }
                      className="text-xs text-red-700 underline"
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        set_items((current) =>
                          current.map((row) =>
                            row.product_id === item.product_id
                              ? {
                                  ...row,
                                  qty: decrease_qty(row.quantity, row.qty),
                                }
                              : row,
                          ),
                        )
                      }
                      className="h-9 w-9 rounded-md border"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step={step}
                      value={item.qty}
                      disabled={saving}
                      onChange={(e) =>
                        set_items((current) =>
                          current.map((row) =>
                            row.product_id === item.product_id
                              ? { ...row, qty: Number(e.target.value) }
                              : row,
                          ),
                        )
                      }
                      className="h-9 w-24 rounded-md border px-2 text-center"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        set_items((current) =>
                          current.map((row) =>
                            row.product_id === item.product_id
                              ? {
                                  ...row,
                                  qty: increase_qty(row.quantity, row.qty),
                                }
                              : row,
                          ),
                        )
                      }
                      className="h-9 w-9 rounded-md border"
                    >
                      +
                    </button>
                  </div>
                  {!check.valid && check.message ? (
                    <p className="mt-2 text-xs text-red-700">{check.message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || items.length === 0}
          className="rounded-md bg-teal-700 px-4 py-3 text-sm text-white disabled:bg-slate-300"
        >
          {saving ? UI_SAVING : UI_SAVE}
        </button>
        <Link
          href={`/staff/orders/${order_id}`}
          className="rounded-md border px-4 py-3 text-sm"
        >
          {UI_CANCEL}
        </Link>
      </div>
    </form>
  );
}
