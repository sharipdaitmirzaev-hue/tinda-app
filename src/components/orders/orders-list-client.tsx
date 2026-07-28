"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orders/constants";
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from "@/components/ui/state-blocks";
import { UI_LOAD_ERROR } from "@/lib/i18n/ui-copy";

type OrderListItem = {
  id: string;
  number: string;
  status: string;
  status_label: string;
  created_at: string;
  desired_delivery_date: string;
  is_urgent: boolean;
  items_count: number;
  total_qty: number;
  address: string;
};

function format_datetime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function format_date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function OrdersListClient() {
  const router = useRouter();
  const search_params = useSearchParams();
  const [items, set_items] = useState<OrderListItem[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const status = search_params.get("status") || "";
  const date_from = search_params.get("date_from") || "";
  const date_to = search_params.get("date_to") || "";
  const q = search_params.get("q") || "";
  const page = Number(search_params.get("page") || "1");
  const page_size = Number(search_params.get("page_size") || "20");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      set_loading(true);
      set_error(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(page_size),
        });
        if (status) params.set("status", status);
        if (date_from) params.set("date_from", date_from);
        if (date_to) params.set("date_to", date_to);
        if (q) params.set("q", q);

        const response = await fetch(
          `/api/v1/client/orders?${params.toString()}`,
          { credentials: "same-origin" },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message ?? "Не удалось загрузить заказы");
        }
        if (!cancelled) {
          set_items(data.items ?? []);
          set_total(data.total ?? 0);
        }
      } catch (err) {
        if (!cancelled) {
          set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
          set_items([]);
          set_total(0);
        }
      } finally {
        if (!cancelled) set_loading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [status, date_from, date_to, q, page, page_size]);

  function update_query(next: Record<string, string>, reset_page = true) {
    const params = new URLSearchParams(search_params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (reset_page && !("page" in next)) params.delete("page");
    router.push(`/orders?${params.toString()}`);
  }

  function on_filter_submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update_query({
      status: String(form.get("status") ?? ""),
      date_from: String(form.get("date_from") ?? ""),
      date_to: String(form.get("date_to") ?? ""),
      q: String(form.get("q") ?? "").trim(),
    });
  }

  const total_pages = Math.max(1, Math.ceil(total / page_size));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Мои заказы</h1>

      <form
        onSubmit={on_filter_submit}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-sm lg:col-span-1">
          <span className="mb-1 block text-slate-600">Статус</span>
          <select
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            {ORDER_STATUSES.map((code) => (
              <option key={code} value={code}>
                {ORDER_STATUS_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">С даты</span>
          <input
            type="date"
            name="date_from"
            defaultValue={date_from}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">До даты</span>
          <input
            type="date"
            name="date_to"
            defaultValue={date_to}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm md:col-span-2 lg:col-span-1">
          <span className="mb-1 block text-slate-600">Номер заказа</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="T-…"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <div className="flex items-end gap-2 md:col-span-2 lg:col-span-1">
          <button
            type="submit"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
          >
            Применить
          </button>
          <button
            type="button"
            onClick={() => router.push("/orders")}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Сбросить
          </button>
        </div>
      </form>

      {loading ? <LoadingBlock label="Загрузка заказов…" /> : null}

      {error ? (
        <ErrorBlock
          message={error}
          on_retry={() => update_query({ page: String(page) }, false)}
        />
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyBlock
          title="Заказов пока нет"
          description="Оформите заказ из каталога"
          action={
            <Link href="/catalog" className="ui-btn-primary">
              Перейти в каталог
            </Link>
          }
        />
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <ul className="space-y-3 md:hidden">
            {items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-teal-900">{order.number}</p>
                    <span className="text-xs font-medium text-slate-700">
                      {order.status_label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Создан: {format_datetime(order.created_at)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Доставка: {format_date(order.desired_delivery_date)}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {order.items_count} поз. · {order.total_qty} ед.
                    {order.is_urgent ? " · Срочный" : ""}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                    {order.address}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Номер</th>
                  <th className="px-4 py-3">Создан</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Доставка</th>
                  <th className="px-4 py-3">Позиции</th>
                  <th className="px-4 py-3">Адрес</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-medium text-teal-800 underline"
                      >
                        {order.number}
                      </Link>
                      {order.is_urgent ? (
                        <span className="ml-2 text-xs text-amber-700">
                          Срочный
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {format_datetime(order.created_at)}
                    </td>
                    <td className="px-4 py-3">{order.status_label}</td>
                    <td className="px-4 py-3">
                      {format_date(order.desired_delivery_date)}
                    </td>
                    <td className="px-4 py-3">
                      {order.items_count} / {order.total_qty}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                      {order.address}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <p>
              Страница {page} из {total_pages} · всего {total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() =>
                  update_query({ page: String(page - 1) }, false)
                }
                className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={page >= total_pages}
                onClick={() =>
                  update_query({ page: String(page + 1) }, false)
                }
                className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Вперёд
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
