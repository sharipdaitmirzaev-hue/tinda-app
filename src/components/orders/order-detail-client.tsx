"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import {
  UI_CANCELLING,
  UI_GENERIC_ERROR,
  UI_LOAD_ERROR,
  UI_LOAD_ORDER_ERROR,
  UI_RETRY,
} from "@/lib/i18n/ui-copy";

type OrderDetails = {
  id: string;
  number: string;
  status: string;
  status_label: string;
  created_at: string;
  desired_delivery_date: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  payment_method_label: string;
  is_urgent: boolean;
  client_comment: string | null;
  cancel_reason: string | null;
  can_edit: boolean;
  can_cancel: boolean;
  items_count: number;
  total_qty: number;
  items: Array<{
    id: string;
    product_name: string;
    product_sku: string;
    package_info: string | null;
    sale_unit: string;
    qty: number;
    image_url?: string | null;
  }>;
  status_history: Array<{
    id: string;
    from_status_label: string | null;
    to_status_label: string;
    comment: string | null;
    created_at: string;
  }>;
};

function format_datetime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function format_date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function OrderDetailClient({ order_id }: { order_id: string }) {
  const router = useRouter();
  const [order, set_order] = useState<OrderDetails | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);
  const [confirm_cancel, set_confirm_cancel] = useState(false);
  const [cancel_reason, set_cancel_reason] = useState("");
  const [cancelling, set_cancelling] = useState(false);

  async function load() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/client/orders/${order_id}`, {
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? UI_LOAD_ORDER_ERROR);
      }
      set_order(data.order);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
      set_order(null);
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order_id]);

  async function on_cancel() {
    if (cancelling) return;
    set_cancelling(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/client/orders/${order_id}/cancel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: cancel_reason.trim() ? cancel_reason.trim() : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось отменить заказ");
      }
      set_order(data.order);
      set_message(data.message ?? "Заказ отменён");
      set_confirm_cancel(false);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_cancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-white"
        >
          {UI_RETRY}
        </button>
        <button
          type="button"
          onClick={() => router.push("/orders")}
          className="ml-2 mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5"
        >
          К списку
        </button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/orders" className="text-sm text-teal-800 underline">
            ← К заказам
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            {order.number}
          </h1>
          <p className="text-sm text-slate-700">
            Статус: <span className="font-medium">{order.status_label}</span>
            {order.is_urgent ? (
              <span className="ml-2 text-amber-700">Срочный</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.can_edit ? (
            <Link
              href={`/orders/${order.id}/edit`}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              Изменить
            </Link>
          ) : null}
          {order.can_cancel ? (
            <button
              type="button"
              onClick={() => set_confirm_cancel(true)}
              className="rounded-md border border-red-200 px-4 py-2 text-sm text-red-700"
            >
              Отменить заказ
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {confirm_cancel ? (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">
            Отменить заказ {order.number}?
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-red-900">Причина (необязательно)</span>
            <textarea
              value={cancel_reason}
              onChange={(e) => set_cancel_reason(e.target.value)}
              maxLength={1000}
              rows={3}
              disabled={cancelling}
              className="w-full rounded-md border border-red-200 px-3 py-2"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cancelling}
              onClick={() => void on_cancel()}
              className="rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {cancelling ? UI_CANCELLING : "Отменить"}
            </button>
            <button
              type="button"
              disabled={cancelling}
              onClick={() => set_confirm_cancel(false)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              Не отменять
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Данные заказа</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Создан</dt>
              <dd className="text-right">{format_datetime(order.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Желаемая доставка</dt>
              <dd className="text-right">
                {format_date(order.desired_delivery_date)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Адрес</dt>
              <dd className="text-right">{order.address}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Контакт</dt>
              <dd className="text-right">{order.contact_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Телефон</dt>
              <dd className="text-right">{order.contact_phone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Оплата</dt>
              <dd className="text-right">{order.payment_method_label}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Позиции / единицы</dt>
              <dd>
                {order.items_count} / {order.total_qty}
              </dd>
            </div>
          </dl>
          {order.client_comment ? (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Комментарий: {order.client_comment}
            </p>
          ) : null}
          {order.cancel_reason ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              Причина отмены: {order.cancel_reason}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">История статусов</h2>
          <ul className="mt-3 space-y-3">
            {order.status_history.map((row) => (
              <li key={row.id} className="border-b border-slate-100 pb-3 text-sm last:border-0">
                <p className="font-medium text-slate-900">
                  {row.from_status_label
                    ? `${row.from_status_label} → ${row.to_status_label}`
                    : row.to_status_label}
                </p>
                <p className="text-xs text-slate-500">
                  {format_datetime(row.created_at)}
                </p>
                {row.comment ? (
                  <p className="mt-1 text-slate-600">{row.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Состав заказа</h2>
        <ul className="mt-3 space-y-3 md:hidden">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 border-b border-slate-100 pb-3 text-sm last:border-0">
              <ProductImage
                src={item.image_url}
                alt={item.product_name}
                className="h-14 w-14 shrink-0"
              />
              <div>
                <p className="font-medium">{item.product_name}</p>
                <p className="text-xs text-slate-500">Артикул: {item.product_sku}</p>
                <p className="text-xs text-slate-600">{item.package_info || "—"}</p>
                <p className="mt-1">
                  {item.qty} {item.sale_unit}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Фото</th>
                <th className="px-3 py-2">Товар</th>
                <th className="px-3 py-2">Артикул</th>
                <th className="px-3 py-2">Упаковка</th>
                <th className="px-3 py-2">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <ProductImage
                      src={item.image_url}
                      alt={item.product_name}
                      className="h-12 w-12"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{item.product_name}</td>
                  <td className="px-3 py-2 text-slate-600">{item.product_sku}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {item.package_info || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {item.qty} {item.sale_unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
