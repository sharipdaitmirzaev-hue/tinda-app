"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import {
  UI_EMPTY_SEARCH_HINT,
  UI_EMPTY_SEARCH_TITLE,
  UI_GENERIC_ERROR,
  UI_LOAD_ERROR,
  UI_LOAD_PRODUCTS_ERROR,
} from "@/lib/i18n/ui-copy";

type CategoryFlat = { id: string; name: string };
type ProductItem = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category_name: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  availability_label: string;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  is_active: boolean;
  image_url: string | null;
  price_amount?: number;
  price?: { amount: number; currency: string; unit: string } | null;
  updated_at: string;
};

function format_updated_at(value: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ProductsList() {
  const router = useRouter();
  const search_params = useSearchParams();
  const [items, set_items] = useState<ProductItem[]>([]);
  const [categories, set_categories] = useState<CategoryFlat[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [import_message, set_import_message] = useState<string | null>(null);
  const [import_pending, set_import_pending] = useState(false);

  const q = search_params.get("q") || "";
  const category_id = search_params.get("category_id") || "";
  const availability = search_params.get("availability") || "";
  const is_active = search_params.get("is_active") || "";
  const is_promo = search_params.get("is_promo") || "";
  const is_new = search_params.get("is_new") || "";
  const is_hit = search_params.get("is_hit") || "";
  const sort = search_params.get("sort") || "created_at_desc";
  const page = Number(search_params.get("page") || "1");
  const page_size = Number(search_params.get("page_size") || "20");
  const flash = search_params.get("flash");

  useEffect(() => {
    fetch("/api/v1/staff/categories")
      .then((res) => res.json())
      .then((data) => set_categories(data.flat ?? []))
      .catch(() => set_categories([]));
  }, []);

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
        if (q) params.set("q", q);
        if (category_id) params.set("category_id", category_id);
        if (availability) params.set("availability", availability);
        if (is_active) params.set("is_active", is_active);
        if (is_promo) params.set("is_promo", is_promo);
        if (is_new) params.set("is_new", is_new);
        if (is_hit) params.set("is_hit", is_hit);

        const response = await fetch(
          `/api/v1/staff/products?${params.toString()}`,
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message ?? UI_LOAD_PRODUCTS_ERROR);
        }
        if (!cancelled) {
          set_items(data.items ?? []);
          set_total(data.total ?? 0);
        }
      } catch (err) {
        if (!cancelled) {
          set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
        }
      } finally {
        if (!cancelled) set_loading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [
    q,
    category_id,
    availability,
    is_active,
    is_promo,
    is_new,
    is_hit,
    sort,
    page,
    page_size,
  ]);

  function update_query(next: Record<string, string>) {
    const params = new URLSearchParams(search_params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (!next.page) params.delete("page");
    router.push(`/staff/products?${params.toString()}`);
  }

  function on_filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update_query({
      q: String(form.get("q") || ""),
      category_id: String(form.get("category_id") || ""),
      availability: String(form.get("availability") || ""),
      is_active: String(form.get("is_active") || ""),
      is_promo: String(form.get("is_promo") || ""),
      is_new: String(form.get("is_new") || ""),
      is_hit: String(form.get("is_hit") || ""),
      sort: String(form.get("sort") || "created_at_desc"),
      page_size: String(form.get("page_size") || "20"),
      page: "1",
    });
  }

  async function on_import_prices(file: File | null) {
    if (!file) return;
    set_import_pending(true);
    set_import_message(null);
    set_error(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/v1/staff/products/import-prices", {
        method: "POST",
        body,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Импорт не выполнен");
      }
      const failed = Number(data.failed ?? 0);
      set_import_message(
        failed > 0
          ? `${data.message}. Ошибок: ${failed}`
          : String(data.message ?? "Цены обновлены"),
      );
      // reload list
      router.refresh();
      update_query({ page: String(page) });
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_import_pending(false);
    }
  }

  const total_pages = Math.max(1, Math.ceil(total / page_size));

  return (
    <div className="space-y-4">
      {flash === "saved" ? (
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
          Товар сохранён
        </p>
      ) : null}
      {import_message ? (
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {import_message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="ui-btn-secondary cursor-pointer">
          {import_pending ? "Импорт…" : "Импорт цен (Excel)"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={import_pending}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              void on_import_prices(file);
            }}
          />
        </label>
        <Link
          href="/staff/products/new"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
        >
          Новый товар
        </Link>
      </div>

      <form
        onSubmit={on_filter}
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3"
      >
        <label className="text-sm md:col-span-3">
          <span className="mb-1 block font-medium">Поиск</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Название, артикул, бренд"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Категория</span>
          <select
            name="category_id"
            defaultValue={category_id}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Наличие</span>
          <select
            name="availability"
            defaultValue={availability}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Любое</option>
            <option value="in_stock">В наличии</option>
            <option value="on_order">Под заказ</option>
            <option value="out_of_stock">Временно нет</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Активность</span>
          <select
            name="is_active"
            defaultValue={is_active}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            <option value="true">Активные</option>
            <option value="false">Неактивные</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Акция</span>
          <select
            name="is_promo"
            defaultValue={is_promo}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Новинка</span>
          <select
            name="is_new"
            defaultValue={is_new}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Хит</span>
          <select
            name="is_hit"
            defaultValue={is_hit}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Сортировка</span>
          <select
            name="sort"
            defaultValue={sort}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="created_at_desc">Сначала новые</option>
            <option value="created_at_asc">Сначала старые</option>
            <option value="name_asc">Название А–Я</option>
            <option value="name_desc">Название Я–А</option>
            <option value="is_new_desc">Новинки сверху</option>
            <option value="is_hit_desc">Хиты сверху</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">На странице</span>
          <select
            name="page_size"
            defaultValue={String(page_size)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <div className="md:col-span-3">
          <button
            type="submit"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
          >
            Применить
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-600" role="status">
          Загрузка…
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-slate-600">
          {q ||
          category_id ||
          availability ||
          is_active ||
          is_promo ||
          is_new ||
          is_hit
            ? `${UI_EMPTY_SEARCH_TITLE}. ${UI_EMPTY_SEARCH_HINT}`
            : "Товаров пока нет"}
        </p>
      ) : null}

      {!loading && items.length > 0 ? (
        <>
          <ul className="space-y-3 md:hidden">
            {items.map((item) => (
              <li key={item.id} className="ui-card p-3">
                <div className="flex gap-3">
                  <ProductImage src={item.image_url} alt={item.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/staff/products/${item.id}`}
                      className="font-medium text-teal-800 underline-offset-2 hover:underline"
                    >
                      {item.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      Артикул: {item.sku}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {item.category_name ?? "—"} · {item.availability_label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {(item.price?.amount ?? item.price_amount ?? 0).toLocaleString(
                        "ru-RU",
                      )}{" "}
                      ₽ / {item.sale_unit}
                    </p>
                    <p className="mt-1">
                      {item.is_active ? (
                        <span className="ui-status-approved">Активен</span>
                      ) : (
                        <span className="ui-status-pending">Неактивен</span>
                      )}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Фото</th>
                  <th className="px-3 py-2">Артикул</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Бренд</th>
                  <th className="px-3 py-2">Категория</th>
                  <th className="px-3 py-2">Объём</th>
                  <th className="px-3 py-2">Упаковка</th>
                  <th className="px-3 py-2">Наличие</th>
                  <th className="px-3 py-2">Цена</th>
                  <th className="px-3 py-2">Метки</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Обновлён</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <ProductImage src={item.image_url} alt={item.name} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {item.sku}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/staff/products/${item.id}`}
                        className="font-medium text-teal-800 underline-offset-2 hover:underline"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{item.brand ?? "—"}</td>
                    <td className="px-3 py-2">{item.category_name ?? "—"}</td>
                    <td className="px-3 py-2">{item.volume_text ?? "—"}</td>
                    <td className="px-3 py-2">{item.package_type ?? "—"}</td>
                    <td className="px-3 py-2">{item.availability_label}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {(item.price?.amount ?? item.price_amount ?? 0).toLocaleString(
                        "ru-RU",
                      )}{" "}
                      ₽
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {[
                        item.is_promo ? "Акция" : null,
                        item.is_new ? "Новинка" : null,
                        item.is_hit ? "Хит" : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {item.is_active ? (
                        <span className="text-teal-800">Активен</span>
                      ) : (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                          Неактивен
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {format_updated_at(item.updated_at)}
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
                className="rounded-md border px-3 py-1 disabled:opacity-40"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={page >= total_pages}
                onClick={() => update_query({ page: String(page + 1) })}
                className="rounded-md border px-3 py-1 disabled:opacity-40"
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
