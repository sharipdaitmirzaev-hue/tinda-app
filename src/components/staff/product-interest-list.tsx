"use client";

import { useCallback, useEffect, useState } from "react";
import {
  INTEREST_REQUEST_STATUS_LABELS,
  INTEREST_REQUEST_TYPE_LABELS,
  type InterestRequestStatus,
  type InterestRequestType,
} from "@/lib/catalog/constants";
import {
  UI_CLOSE,
  UI_LOAD_ERROR,
} from "@/lib/i18n/ui-copy";

type InterestRow = {
  id: string;
  created_at: string;
  request_type: string;
  requested_qty: number | null;
  comment: string | null;
  status: string;
  product: { id: string; sku: string; name: string };
  client: {
    id: string;
    company_name: string;
    phone: string;
    contact_name: string;
    full_name: string;
  };
  assigned_manager: { id: string; full_name: string } | null;
};

type Analytics = {
  top_products: Array<{
    product_id: string;
    sku: string | null;
    name: string | null;
    requests_count: number;
    unique_clients: number;
    requested_qty_sum: number;
  }>;
  recent_requests: InterestRow[];
};

export function ProductInterestList() {
  const [items, set_items] = useState<InterestRow[]>([]);
  const [analytics, set_analytics] = useState<Analytics | null>(null);
  const [status, set_status] = useState("");
  const [sort, set_sort] = useState("newest");
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);

  const load = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (sort) qs.set("sort", sort);
      const res = await fetch(`/api/v1/staff/product-interest?${qs}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Не удалось загрузить");
      }
      set_items(data.items || []);
      set_analytics(data.analytics || null);
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
    } finally {
      set_loading(false);
    }
  }, [status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function set_request_status(
    id: string,
    next: InterestRequestStatus,
    assign_self = false,
  ) {
    set_message(null);
    const res = await fetch(`/api/v1/staff/product-interest/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, assign_self }),
    });
    const data = await res.json();
    if (!res.ok) {
      set_error(data?.error?.message || "Не удалось обновить");
      return;
    }
    set_message("Статус обновлён");
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-slate-700">
          Статус{" "}
          <select
            className="ml-1 rounded border border-slate-300 px-2 py-1"
            value={status}
            onChange={(e) => set_status(e.target.value)}
          >
            <option value="">Все</option>
            <option value="new">Новый</option>
            <option value="contacted">Связались</option>
            <option value="closed">Закрыт</option>
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Сортировка спроса{" "}
          <select
            className="ml-1 rounded border border-slate-300 px-2 py-1"
            value={sort}
            onChange={(e) => set_sort(e.target.value)}
          >
            <option value="newest">Новые запросы</option>
            <option value="most_requests">Больше запросов</option>
            <option value="most_clients">Больше клиентов</option>
          </select>
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-teal-800">{message}</p> : null}

      {analytics ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Спрос по товарам
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Артикул</th>
                  <th className="py-2 pr-3">Товар</th>
                  <th className="py-2 pr-3">Запросов</th>
                  <th className="py-2 pr-3">Клиентов</th>
                  <th className="py-2 pr-3">Σ кол-во</th>
                </tr>
              </thead>
              <tbody>
                {analytics.top_products.map((row) => (
                  <tr key={row.product_id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs">{row.sku}</td>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3">{row.requests_count}</td>
                    <td className="py-2 pr-3">{row.unique_clients}</td>
                    <td className="py-2 pr-3">{row.requested_qty_sum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Запросы</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Запросов пока нет</p>
        ) : (
          <div className="mt-3 space-y-3">
            {items.map((row) => (
              <article
                key={row.id}
                className="rounded-md border border-slate-200 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {row.product.name}{" "}
                      <span className="font-mono text-xs text-slate-500">
                        {row.product.sku}
                      </span>
                    </p>
                    <p className="text-slate-600">
                      {row.client.company_name} · {row.client.contact_name} ·{" "}
                      {row.client.phone}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(row.created_at).toLocaleString("ru-RU")} ·{" "}
                      {
                        INTEREST_REQUEST_TYPE_LABELS[
                          row.request_type as InterestRequestType
                        ]
                      }{" "}
                      ·{" "}
                      {
                        INTEREST_REQUEST_STATUS_LABELS[
                          row.status as InterestRequestStatus
                        ]
                      }
                      {row.requested_qty
                        ? ` · желаемое кол-во: ${row.requested_qty}`
                        : ""}
                    </p>
                    {row.comment ? (
                      <p className="mt-1 text-slate-700">{row.comment}</p>
                    ) : null}
                    {row.assigned_manager ? (
                      <p className="text-xs text-slate-500">
                        Менеджер: {row.assigned_manager.full_name}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void set_request_status(row.id, "contacted", true)
                      }
                    >
                      Взять в работу
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void set_request_status(row.id, "contacted")
                      }
                    >
                      Связались
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() => void set_request_status(row.id, "closed")}
                    >
                      {UI_CLOSE}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
