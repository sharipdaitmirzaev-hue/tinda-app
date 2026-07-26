"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type CityItem = { id: string; name: string; region: string };

type RequestItem = {
  id: string;
  company_name: string;
  inn: string;
  city: { id: string; name: string };
  client_type_label: string | null;
  contact_name: string;
  phone: string;
  email: string;
  created_at: string;
  status: string;
  manager: { id: string; full_name: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "На рассмотрении",
  rejected: "Отклонена",
};

export function RegistrationRequestsList() {
  const router = useRouter();
  const search_params = useSearchParams();
  const [items, set_items] = useState<RequestItem[]>([]);
  const [cities, set_cities] = useState<CityItem[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const status = search_params.get("status") || "pending";
  const city_id = search_params.get("city_id") || "";
  const q = search_params.get("q") || "";
  const page = Number(search_params.get("page") || "1");
  const page_size = 20;
  const flash = search_params.get("flash");

  useEffect(() => {
    fetch("/api/v1/cities")
      .then((res) => res.json())
      .then((data) => set_cities(data.items ?? []))
      .catch(() => set_cities([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      set_loading(true);
      set_error(null);
      try {
        const params = new URLSearchParams({
          status,
          page: String(page),
          page_size: String(page_size),
        });
        if (city_id) params.set("city_id", city_id);
        if (q) params.set("q", q);

        const response = await fetch(
          `/api/v1/staff/registration-requests?${params.toString()}`,
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message ?? "Не удалось загрузить заявки");
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
    load();
    return () => {
      cancelled = true;
    };
  }, [status, city_id, q, page]);

  function update_query(next: Record<string, string>) {
    const params = new URLSearchParams(search_params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (!next.page) params.delete("page");
    router.push(`/staff/registration-requests?${params.toString()}`);
  }

  function on_filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update_query({
      status: String(form.get("status") || "pending"),
      city_id: String(form.get("city_id") || ""),
      q: String(form.get("q") || ""),
      page: "1",
    });
  }

  const total_pages = Math.max(1, Math.ceil(total / page_size));

  return (
    <div className="space-y-4">
      {flash === "approved" ? (
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
          Клиент подтверждён
        </p>
      ) : null}
      {flash === "rejected" ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Заявка отклонена
        </p>
      ) : null}

      <form
        onSubmit={on_filter}
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4"
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium">Статус</span>
          <select
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="pending">На рассмотрении</option>
            <option value="rejected">Отклонённые</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Город</span>
          <select
            name="city_id"
            defaultValue={city_id}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все города</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block font-medium">Поиск</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Компания, ИНН, телефон, email"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <div className="md:col-span-4">
          <button
            type="submit"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
          >
            Применить фильтры
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-600">Загрузка заявок…</p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600">
          {q || city_id
            ? "Нет результатов поиска"
            : status === "rejected"
              ? "Отклонённых заявок нет"
              : "Новых заявок пока нет"}
        </p>
      ) : null}

      {!loading && items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Компания</th>
                  <th className="px-3 py-2 font-medium">ИНН</th>
                  <th className="px-3 py-2 font-medium">Город</th>
                  <th className="px-3 py-2 font-medium">Тип</th>
                  <th className="px-3 py-2 font-medium">Контакт</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Менеджер</th>
                  <th className="px-3 py-2 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        href={`/staff/registration-requests/${item.id}`}
                        className="font-medium text-teal-800 underline-offset-2 hover:underline"
                      >
                        {item.company_name}
                      </Link>
                      <div className="text-xs text-slate-500">{item.email}</div>
                    </td>
                    <td className="px-3 py-2">{item.inn}</td>
                    <td className="px-3 py-2">{item.city.name}</td>
                    <td className="px-3 py-2">
                      {item.client_type_label ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div>{item.contact_name}</div>
                      <div className="text-xs text-slate-500">{item.phone}</div>
                    </td>
                    <td className="px-3 py-2">
                      {STATUS_LABELS[item.status] ?? item.status}
                    </td>
                    <td className="px-3 py-2">
                      {item.manager?.full_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(item.created_at).toLocaleString("ru-RU")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              Всего: {total}. Страница {page} из {total_pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => update_query({ page: String(page - 1) })}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={page >= total_pages}
                onClick={() => update_query({ page: String(page + 1) })}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Далее
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
