"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orders/constants";
import { STAFF_ORDER_SORT_OPTIONS } from "@/lib/validators/orders";

type OrderItem = {
  id: string;
  number: string;
  created_at: string;
  client_company_name: string;
  client_inn: string;
  manager: { id: string; full_name: string } | null;
  status: string;
  status_label: string;
  is_urgent: boolean;
  desired_delivery_date: string;
  city: { id: string; name: string };
  items_count: number;
  total_qty: number;
};

type CityItem = { id: string; name: string };
type ManagerItem = { id: string; full_name: string };

const SORT_LABELS: Record<(typeof STAFF_ORDER_SORT_OPTIONS)[number], string> = {
  created_at_desc: "Сначала новые",
  created_at_asc: "Сначала старые",
  desired_delivery_date_asc: "Дата доставки ↑",
  desired_delivery_date_desc: "Дата доставки ↓",
  is_urgent_desc: "Сначала срочные",
};

function format_datetime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function format_date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function StaffOrdersList({ is_director }: { is_director: boolean }) {
  const router = useRouter();
  const search_params = useSearchParams();
  const [items, set_items] = useState<OrderItem[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [cities, set_cities] = useState<CityItem[]>([]);
  const [managers, set_managers] = useState<ManagerItem[]>([]);
  const [filters_open, set_filters_open] = useState(false);

  const status = search_params.get("status") || "";
  const is_urgent = search_params.get("is_urgent") || "";
  const date_from = search_params.get("date_from") || "";
  const date_to = search_params.get("date_to") || "";
  const manager_id = search_params.get("manager_id") || "";
  const city_id = search_params.get("city_id") || "";
  const q = search_params.get("q") || "";
  const sort = search_params.get("sort") || "created_at_desc";
  const page = Number(search_params.get("page") || "1");
  const page_size = Number(search_params.get("page_size") || "20");

  useEffect(() => {
    fetch("/api/v1/cities")
      .then((res) => res.json())
      .then((data) => set_cities(data.items ?? []))
      .catch(() => set_cities([]));
  }, []);

  useEffect(() => {
    if (!is_director) return;
    fetch("/api/v1/staff/managers")
      .then((res) => res.json())
      .then((data) => set_managers(data.items ?? []))
      .catch(() => set_managers([]));
  }, [is_director]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      set_loading(true);
      set_error(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(page_size),
          sort,
        });
        if (status) params.set("status", status);
        if (is_urgent) params.set("is_urgent", is_urgent);
        if (date_from) params.set("date_from", date_from);
        if (date_to) params.set("date_to", date_to);
        if (manager_id) params.set("manager_id", manager_id);
        if (city_id) params.set("city_id", city_id);
        if (q) params.set("q", q);

        const response = await fetch(
          `/api/v1/staff/orders?${params.toString()}`,
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
          set_error(err instanceof Error ? err.message : "Ошибка загрузки");
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
  }, [
    status,
    is_urgent,
    date_from,
    date_to,
    manager_id,
    city_id,
    q,
    sort,
    page,
    page_size,
  ]);

  function update_query(next: Record<string, string>, reset_page = true) {
    const params = new URLSearchParams(search_params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (reset_page && !("page" in next)) params.delete("page");
    router.push(`/staff/orders?${params.toString()}`);
  }

  function on_filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update_query({
      status: String(form.get("status") || ""),
      is_urgent: String(form.get("is_urgent") || ""),
      date_from: String(form.get("date_from") || ""),
      date_to: String(form.get("date_to") || ""),
      manager_id: String(form.get("manager_id") || ""),
      city_id: String(form.get("city_id") || ""),
      q: String(form.get("q") || "").trim(),
      sort: String(form.get("sort") || "created_at_desc"),
    });
    set_filters_open(false);
  }

  const total_pages = Math.max(1, Math.ceil(total / page_size));

  const filter_form = (
    <form onSubmit={on_filter} className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
      <label className="text-sm">
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
        <span className="mb-1 block text-slate-600">Срочность</span>
        <select
          name="is_urgent"
          defaultValue={is_urgent}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Все</option>
          <option value="true">Только срочные</option>
          <option value="false">Без срочных</option>
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
        <span className="mb-1 block text-slate-600">По дату</span>
        <input
          type="date"
          name="date_to"
          defaultValue={date_to}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Город</span>
        <select
          name="city_id"
          defaultValue={city_id}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Все</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
      </label>
      {is_director ? (
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Менеджер</span>
          <select
            name="manager_id"
            defaultValue={manager_id}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.full_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-sm md:col-span-2">
        <span className="mb-1 block text-slate-600">Поиск</span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Номер, клиент, ИНН"
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Сортировка</span>
        <select
          name="sort"
          defaultValue={sort}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          {STAFF_ORDER_SORT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
        >
          Применить
        </button>
        <button
          type="button"
          onClick={() => router.push("/staff/orders")}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Сбросить
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Заказы</h1>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm md:hidden"
          onClick={() => set_filters_open((open) => !open)}
        >
          {filters_open ? "Скрыть фильтры" : "Фильтры"}
        </button>
      </div>

      <div className="hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:block">
        {filter_form}
      </div>
      {filters_open ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:hidden">
          {filter_form}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-white"
            onClick={() => update_query({ page: String(page) }, false)}
          >
            Повторить
          </button>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-slate-600">
          Заказы не найдены
        </div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <ul className="space-y-3 md:hidden">
            {items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/staff/orders/${order.id}`}
                  className={`block rounded-xl border p-4 shadow-sm ${
                    order.is_urgent
                      ? "border-amber-300 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <p className="font-semibold text-teal-900">{order.number}</p>
                    <span className="text-xs">{order.status_label}</span>
                  </div>
                  <p className="mt-1 text-sm">{order.client_company_name}</p>
                  <p className="text-xs text-slate-500">ИНН {order.client_inn}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    {format_datetime(order.created_at)} · доставка{" "}
                    {format_date(order.desired_delivery_date)}
                  </p>
                  <p className="text-xs text-slate-600">
                    {order.city.name} · {order.items_count} поз. / {order.total_qty}{" "}
                    ед.
                    {order.is_urgent ? " · Срочный" : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-3">Номер</th>
                  <th className="px-3 py-3">Создан</th>
                  <th className="px-3 py-3">Клиент</th>
                  <th className="px-3 py-3">Менеджер</th>
                  <th className="px-3 py-3">Статус</th>
                  <th className="px-3 py-3">Доставка</th>
                  <th className="px-3 py-3">Город</th>
                  <th className="px-3 py-3">Поз./ед.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr
                    key={order.id}
                    className={`border-b last:border-0 ${
                      order.is_urgent ? "bg-amber-50" : ""
                    }`}
                  >
                    <td className="px-3 py-3">
                      <Link
                        href={`/staff/orders/${order.id}`}
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
                    <td className="px-3 py-3 text-slate-600">
                      {format_datetime(order.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div>{order.client_company_name}</div>
                      <div className="text-xs text-slate-500">
                        ИНН {order.client_inn}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {order.manager?.full_name || "—"}
                    </td>
                    <td className="px-3 py-3">{order.status_label}</td>
                    <td className="px-3 py-3">
                      {format_date(order.desired_delivery_date)}
                    </td>
                    <td className="px-3 py-3">{order.city.name}</td>
                    <td className="px-3 py-3">
                      {order.items_count}/{order.total_qty}
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
                onClick={() => update_query({ page: String(page - 1) }, false)}
                className="rounded-md border px-3 py-1.5 disabled:opacity-40"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={page >= total_pages}
                onClick={() => update_query({ page: String(page + 1) }, false)}
                className="rounded-md border px-3 py-1.5 disabled:opacity-40"
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
