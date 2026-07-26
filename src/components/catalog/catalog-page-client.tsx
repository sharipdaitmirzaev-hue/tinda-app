"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogProductCard, type CatalogProduct } from "@/components/catalog/catalog-product-card";
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from "@/components/ui/state-blocks";

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  children: CategoryNode[];
};

function flatten_categories(nodes: CategoryNode[], depth = 0): Array<CategoryNode & { depth: number }> {
  const result: Array<CategoryNode & { depth: number }> = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    result.push(...flatten_categories(node.children, depth + 1));
  }
  return result;
}

export function CatalogPageClient() {
  const router = useRouter();
  const search_params = useSearchParams();

  const q = search_params.get("q") || "";
  const category_id = search_params.get("category_id") || "";
  const availability = search_params.get("availability") || "";
  const is_promo = search_params.get("is_promo") === "true";
  const is_new = search_params.get("is_new") === "true";
  const is_hit = search_params.get("is_hit") === "true";
  const sort = search_params.get("sort") || "name_asc";
  const page = Number(search_params.get("page") || "1");
  const page_size = Number(search_params.get("page_size") || "12");

  const [categories, set_categories] = useState<CategoryNode[]>([]);
  const [items, set_items] = useState<CatalogProduct[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [search_input, set_search_input] = useState(q);

  const flat_categories = useMemo(
    () => flatten_categories(categories),
    [categories],
  );

  const update_params = useCallback(
    (patch: Record<string, string | null>, reset_page = true) => {
      const params = new URLSearchParams(search_params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (reset_page && patch.page === undefined) {
        params.delete("page");
      }
      const query = params.toString();
      router.push(query ? `/catalog?${query}` : "/catalog");
    },
    [router, search_params],
  );

  useEffect(() => {
    set_search_input(q);
  }, [q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search_input === q) return;
      update_params({ q: search_input.trim() || null });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search_input, q, update_params]);

  useEffect(() => {
    fetch("/api/v1/catalog/categories")
      .then((res) => res.json())
      .then((data) => set_categories(data.items ?? []))
      .catch(() => set_categories([]));
  }, []);

  const load_products = useCallback(async () => {
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
      if (is_promo) params.set("is_promo", "true");
      if (is_new) params.set("is_new", "true");
      if (is_hit) params.set("is_hit", "true");

      const response = await fetch(`/api/v1/catalog/products?${params}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить товары");
      }
      set_items(data.items ?? []);
      set_total(data.total ?? 0);
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
      set_items([]);
      set_total(0);
    } finally {
      set_loading(false);
    }
  }, [
    page,
    page_size,
    sort,
    q,
    category_id,
    availability,
    is_promo,
    is_new,
    is_hit,
  ]);

  useEffect(() => {
    load_products();
  }, [load_products]);

  const total_pages = Math.max(1, Math.ceil(total / page_size));
  const has_filters = Boolean(
    q || category_id || availability || is_promo || is_new || is_hit,
  );

  function reset_filters() {
    set_search_input("");
    router.push("/catalog");
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-4 pb-24 md:grid-cols-[240px_1fr] md:pb-8">
      <aside className="hidden md:block">
        <div className="sticky top-20 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Категории</h2>
          <button
            type="button"
            onClick={() => update_params({ category_id: null })}
            className={`mb-2 block w-full rounded-md px-2 py-1.5 text-left text-sm ${
              !category_id ? "bg-teal-50 font-medium text-teal-900" : "text-slate-700"
            }`}
          >
            Все товары
          </button>
          <ul className="space-y-1">
            {flat_categories.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => update_params({ category_id: category.id })}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    category_id === category.id
                      ? "bg-teal-50 font-medium text-teal-900"
                      : "text-slate-700"
                  }`}
                  style={{ paddingLeft: `${category.depth * 12 + 8}px` }}
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-800">Поиск</span>
            <input
              value={search_input}
              onChange={(e) => set_search_input(e.target.value)}
              placeholder="Название, бренд или артикул"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="mt-3 md:hidden">
            <p className="mb-2 text-sm font-medium text-slate-800">Категории</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => update_params({ category_id: null })}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  !category_id
                    ? "bg-teal-800 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                Все
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => update_params({ category_id: category.id })}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                    category_id === category.id
                      ? "bg-teal-800 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
            {category_id
              ? categories
                  .find((c) => c.id === category_id)
                  ?.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => update_params({ category_id: child.id })}
                      className="mt-2 mr-2 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-900"
                    >
                      {child.name}
                    </button>
                  ))
              : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Наличие</span>
              <select
                value={availability}
                onChange={(e) =>
                  update_params({ availability: e.target.value || null })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Все</option>
                <option value="in_stock">В наличии</option>
                <option value="on_order">Под заказ</option>
                <option value="out_of_stock">Временно нет</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Сортировка</span>
              <select
                value={sort}
                onChange={(e) => update_params({ sort: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="name_asc">Название А–Я</option>
                <option value="name_desc">Название Я–А</option>
                <option value="is_new_desc">Сначала новинки</option>
                <option value="is_hit_desc">Сначала хиты</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">На странице</span>
              <select
                value={String(page_size)}
                onChange={(e) =>
                  update_params({ page_size: e.target.value, page: "1" })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="12">12</option>
                <option value="24">24</option>
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={is_promo}
                  onChange={(e) =>
                    update_params({
                      is_promo: e.target.checked ? "true" : null,
                    })
                  }
                />
                Акции
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={is_new}
                  onChange={(e) =>
                    update_params({ is_new: e.target.checked ? "true" : null })
                  }
                />
                Новинки
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={is_hit}
                  onChange={(e) =>
                    update_params({ is_hit: e.target.checked ? "true" : null })
                  }
                />
                Хиты
              </label>
            </div>
          </div>
        </div>

        {loading ? <LoadingBlock label="Загрузка каталога…" /> : null}

        {error ? (
          <ErrorBlock message={error} on_retry={() => void load_products()} />
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <EmptyBlock
            title={has_filters ? "Товары не найдены" : "Каталог пока пуст"}
            action={
              has_filters ? (
                <button
                  type="button"
                  onClick={reset_filters}
                  className="ui-btn-primary"
                >
                  Сбросить фильтры
                </button>
              ) : undefined
            }
          />
        ) : null}

        {!loading && items.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => (
                <CatalogProductCard key={product.id} product={product} />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span>
                Найдено: {total}. Страница {page} из {total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() =>
                    update_params({ page: String(page - 1) }, false)
                  }
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={page >= total_pages}
                  onClick={() =>
                    update_params({ page: String(page + 1) }, false)
                  }
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40 md:inline-flex"
                >
                  Далее
                </button>
                {page < total_pages ? (
                  <button
                    type="button"
                    onClick={() =>
                      update_params({ page: String(page + 1) }, false)
                    }
                    className="rounded-md bg-teal-700 px-3 py-1.5 text-white md:hidden"
                  >
                    Показать ещё
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        <p className="text-xs text-slate-500">
          Цены в каталоге не отображаются. Условия подтвердит менеджер после
          заказа.{" "}
          <Link href="/cart" className="text-teal-800 underline">
            Перейти в корзину
          </Link>
        </p>
      </section>
    </div>
  );
}
