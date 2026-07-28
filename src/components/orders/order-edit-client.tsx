"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { UI_GENERIC_ERROR, UI_LOAD_ERROR } from "@/lib/i18n/ui-copy";
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

type CatalogHit = {
  id: string;
  sku: string;
  name: string;
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  is_active?: boolean;
};

export function OrderEditClient({ order_id }: { order_id: string }) {
  const router = useRouter();
  const min_date = today_date_key();
  const [loading, set_loading] = useState(true);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const [address, set_address] = useState("");
  const [desired_delivery_date, set_desired_delivery_date] = useState(min_date);
  const [contact_name, set_contact_name] = useState("");
  const [contact_phone, set_contact_phone] = useState("");
  const [payment_method, set_payment_method] = useState<PaymentMethod>(
    "bank_transfer",
  );
  const [is_urgent, set_is_urgent] = useState(false);
  const [client_comment, set_client_comment] = useState("");
  const [items, set_items] = useState<EditItem[]>([]);

  const [search_q, set_search_q] = useState("");
  const [search_hits, set_search_hits] = useState<CatalogHit[]>([]);
  const [searching, set_searching] = useState(false);

  async function load() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/client/orders/${order_id}`, {
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить заказ");
      }
      const order = data.order;
      if (!order.can_edit) {
        throw new Error("Заказ уже обработан менеджером. Изменения недоступны");
      }

      set_address(order.address);
      set_desired_delivery_date(
        order.desired_delivery_date < min_date
          ? min_date
          : order.desired_delivery_date,
      );
      set_contact_name(order.contact_name);
      set_contact_phone(order.contact_phone);
      set_payment_method(order.payment_method);
      set_is_urgent(order.is_urgent);
      set_client_comment(order.client_comment ?? "");

      const next_items: EditItem[] = [];
      for (const item of order.items as Array<{
        product_id: string | null;
        product_name: string;
        product_sku: string;
        qty: number;
      }>) {
        if (!item.product_id) continue;
        const product_response = await fetch(
          `/api/v1/catalog/products/${item.product_id}`,
          { credentials: "same-origin" },
        );
        if (!product_response.ok) continue;
        const product_data = await product_response.json();
        const product = product_data.product as CatalogHit;
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
            is_active: true,
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
    set_searching(true);
    try {
      const params = new URLSearchParams({
        q: search_q.trim(),
        page: "1",
        page_size: "10",
      });
      const response = await fetch(
        `/api/v1/catalog/products?${params.toString()}`,
        { credentials: "same-origin" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось найти товары");
      }
      set_search_hits(data.items ?? []);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_searching(false);
    }
  }

  function add_product(product: CatalogHit) {
    if (items.some((item) => item.product_id === product.id)) {
      set_error("Товар уже добавлен в заказ");
      return;
    }
    const quantity: QuantityProduct = {
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
      is_active: true,
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

  function set_item_qty(product_id: string, qty: number) {
    set_items((current) =>
      current.map((item) =>
        item.product_id === product_id ? { ...item, qty } : item,
      ),
    );
  }

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (items.length === 0) {
      set_error("Добавьте хотя бы один товар в заказ");
      return;
    }

    for (const item of items) {
      const check = check_qty(item.quantity, item.qty);
      if (!check.valid) {
        set_error(
          `${item.product_name}: ${check.message ?? "Некорректное количество"}`,
        );
        return;
      }
    }

    set_saving(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/client/orders/${order_id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          desired_delivery_date,
          contact_name,
          contact_phone,
          payment_method,
          is_urgent,
          client_comment: client_comment.trim() ? client_comment.trim() : null,
          items: items.map((item) => ({
            product_id: item.product_id,
            qty: item.qty,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось сохранить заказ");
      }
      router.replace(`/orders/${order_id}`);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
      set_saving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  return (
    <form onSubmit={on_submit} className="space-y-4">
      <div>
        <Link
          href={`/orders/${order_id}`}
          className="text-sm text-teal-800 underline"
        >
          ← К заказу
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Редактирование заказа
        </h1>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Доставка и контакты</h2>
          <label className="block text-sm">
            <span className="mb-1 block">Адрес</span>
            <textarea
              required
              rows={3}
              value={address}
              disabled={saving}
              onChange={(e) => set_address(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Желаемая дата доставки</span>
            <input
              type="date"
              required
              min={min_date}
              value={desired_delivery_date}
              disabled={saving}
              onChange={(e) => set_desired_delivery_date(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Контактное лицо</span>
            <input
              required
              minLength={2}
              value={contact_name}
              disabled={saving}
              onChange={(e) => set_contact_name(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Телефон</span>
            <input
              required
              value={contact_phone}
              disabled={saving}
              onChange={(e) => set_contact_phone(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <fieldset className="space-y-2 text-sm" disabled={saving}>
            <legend className="mb-1 font-medium">Способ оплаты</legend>
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="payment_method"
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
            <span className="mb-1 block">Комментарий</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={client_comment}
              disabled={saving}
              onChange={(e) => set_client_comment(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Состав заказа</h2>
          <div className="flex gap-2">
            <input
              type="search"
              value={search_q}
              disabled={saving}
              onChange={(e) => set_search_q(e.target.value)}
              placeholder="Найти товар для добавления"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={saving || searching}
              onClick={() => void search_products()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              Найти
            </button>
          </div>
          {search_hits.length > 0 ? (
            <ul className="space-y-2 rounded-md border border-slate-200 p-2 text-sm">
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
                    disabled={saving}
                    onClick={() => add_product(product)}
                    className="rounded-md bg-teal-700 px-2 py-1 text-xs text-white"
                  >
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {items.length === 0 ? (
            <p className="text-sm text-red-700">В заказе нет товаров</p>
          ) : null}

          <ul className="space-y-3">
            {items.map((item) => {
              const step = get_order_step(item.quantity);
              const check = check_qty(item.quantity, item.qty);
              return (
                <li
                  key={item.product_id}
                  className="rounded-md border border-slate-200 p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
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
                        set_item_qty(
                          item.product_id,
                          decrease_qty(item.quantity, item.qty),
                        )
                      }
                      className="h-9 w-9 rounded-md border"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      value={Number.isFinite(item.qty) ? item.qty : ""}
                      step={step}
                      disabled={saving}
                      onChange={(e) =>
                        set_item_qty(item.product_id, Number(e.target.value))
                      }
                      className="h-9 w-24 rounded-md border px-2 text-center"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        set_item_qty(
                          item.product_id,
                          increase_qty(item.quantity, item.qty),
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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving || items.length === 0}
          className="rounded-md bg-teal-700 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? "Сохраняем…" : "Сохранить изменения"}
        </button>
        <Link
          href={`/orders/${order_id}`}
          className="rounded-md border border-slate-300 px-4 py-3 text-sm"
        >
          Отмена
        </Link>
      </div>
    </form>
  );
}
