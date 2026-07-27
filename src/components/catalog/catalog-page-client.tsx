"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CatalogProductCard,
  type CatalogProduct,
} from "@/components/catalog/catalog-product-card";
import { CatalogPagination } from "@/components/catalog/catalog-pagination";
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from "@/components/ui/state-blocks";
import {
  CATALOG_PAGE_SIZE_OPTIONS,
  CATALOG_QUICK_CATEGORIES,
  CATALOG_SORT_LABELS,
} from "@/lib/catalog/constants";
import { clampCatalogPage } from "@/lib/catalog/pagination";
import {
  buildCatalogHrefWithQuickView,
  readQuickViewId,
} from "@/lib/catalog/quick-view-url";
import { useCatalogViewer } from "@/components/catalog/catalog-viewer-context";

const CatalogQuickView = dynamic(
  () =>
    import("@/components/catalog/catalog-quick-view").then(
      (mod) => mod.CatalogQuickView,
    ),
  { ssr: false },
);

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  children: CategoryNode[];
};

type CatalogFilters = {
  brands: string[];
  volumes: string[];
  package_types: string[];
  categories: Array<{ id: string; name: string; slug: string }>;
};

function flatten_categories(
  nodes: CategoryNode[],
  depth = 0,
): Array<CategoryNode & { depth: number }> {
  const result: Array<CategoryNode & { depth: number }> = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    result.push(...flatten_categories(node.children, depth + 1));
  }
  return result;
}

function find_category_by_slug(
  nodes: CategoryNode[],
  slug: string,
): CategoryNode | null {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const child = find_category_by_slug(node.children, slug);
    if (child) return child;
  }
  return null;
}

export function CatalogPageClient() {
  const router = useRouter();
  const search_params = useSearchParams();
  const viewer = useCatalogViewer();
  const approved = viewer === "approved";

  const q = search_params.get("q") || "";
  const category =
    search_params.get("category") ||
    search_params.get("category_id") ||
    "";
  const brand = search_params.get("brand") || "";
  const volume = search_params.get("volume") || "";
  const package_type = search_params.get("package_type") || "";
  const availability = search_params.get("availability") || "";
  const sales_status = search_params.get("sales_status") || "";
  const is_new = search_params.get("is_new") === "true";
  const has_price = search_params.get("has_price") === "true";
  const sort = search_params.get("sort") || "name_asc";
  const page = Number(search_params.get("page") || "1");
  const page_size = Number(search_params.get("page_size") || "24");
  const quick_view_id = readQuickViewId(search_params);

  const [categories, set_categories] = useState<CategoryNode[]>([]);
  const [items, set_items] = useState<CatalogProduct[]>([]);
  const [filters, set_filters] = useState<CatalogFilters>({
    brands: [],
    volumes: [],
    package_types: [],
    categories: [],
  });
  const [total, set_total] = useState(0);
  const [total_pages, set_total_pages] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [search_input, set_search_input] = useState(q);
  const [filters_open, set_filters_open] = useState(false);
  const catalog_top_ref = useRef<HTMLElement | null>(null);
  const prev_page_ref = useRef(page);
  const quick_view_return_focus_ref = useRef<HTMLElement | null>(null);

  const flat_categories = useMemo(
    () => flatten_categories(categories),
    [categories],
  );

  const quick_categories = useMemo(() => {
    return CATALOG_QUICK_CATEGORIES.map((quick) => {
      const node = find_category_by_slug(categories, quick.slug);
      return { ...quick, id: node?.id ?? null, available: Boolean(node) };
    }).filter((item) => item.available);
  }, [categories]);

  const update_params = useCallback(
    (patch: Record<string, string | null>, reset_page = true) => {
      const params = new URLSearchParams(search_params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      // Prefer slug-based category; drop legacy id when setting category slug.
      if (patch.category !== undefined) {
        params.delete("category_id");
      }
      if (reset_page && patch.page === undefined) {
        params.delete("page");
      }
      const query = params.toString();
      router.push(query ? `/catalog?${query}` : "/catalog", { scroll: false });
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
    }, 350);
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
      if (category) params.set("category", category);
      if (brand) params.set("brand", brand);
      if (volume) params.set("volume", volume);
      if (package_type) params.set("package_type", package_type);
      if (availability) params.set("availability", availability);
      if (sales_status) params.set("sales_status", sales_status);
      if (is_new) params.set("is_new", "true");
      if (has_price) params.set("has_price", "true");

      const response = await fetch(`/api/v1/catalog/products?${params}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить товары");
      }
      set_items((data.items ?? []) as CatalogProduct[]);
      set_total(data.total ?? 0);
      set_total_pages(data.total_pages ?? 0);
      set_filters({
        brands: data.filters?.brands ?? [],
        volumes: data.filters?.volumes ?? [],
        package_types: data.filters?.package_types ?? [],
        categories: data.filters?.categories ?? [],
      });
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
      set_items([]);
      set_total(0);
      set_total_pages(0);
    } finally {
      set_loading(false);
    }
  }, [
    page,
    page_size,
    sort,
    q,
    category,
    brand,
    volume,
    package_type,
    availability,
    sales_status,
    is_new,
    has_price,
  ]);

  useEffect(() => {
    void load_products();
  }, [load_products]);

  // If filters shrink the result set, clamp page into a valid range.
  useEffect(() => {
    if (loading) return;
    const clamped = clampCatalogPage(page, total_pages, total);
    if (clamped !== page) {
      update_params({ page: String(clamped) }, false);
    }
  }, [loading, page, total, total_pages, update_params]);

  // Scroll to catalog top when the page number changes (Link scroll + fallback).
  useEffect(() => {
    if (prev_page_ref.current === page) return;
    prev_page_ref.current = page;
    catalog_top_ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);

  const has_filters = Boolean(
    q ||
      category ||
      brand ||
      volume ||
      package_type ||
      availability ||
      sales_status ||
      is_new ||
      has_price,
  );

  function reset_filters() {
    set_search_input("");
    set_filters_open(false);
    router.push("/catalog");
  }

  const open_quick_view = useCallback(
    (product_id: string, trigger: HTMLButtonElement | null) => {
      quick_view_return_focus_ref.current = trigger;
      router.push(buildCatalogHrefWithQuickView(search_params, product_id), {
        scroll: false,
      });
    },
    [router, search_params],
  );

  const close_quick_view = useCallback(() => {
    router.push(buildCatalogHrefWithQuickView(search_params, null), {
      scroll: false,
    });
  }, [router, search_params]);

  const filter_controls = (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Категория</span>
        <select
          value={category}
          onChange={(e) =>
            update_params({ category: e.target.value || null })
          }
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Все категории</option>
          {flat_categories.map((item) => (
            <option key={item.id} value={item.slug}>
              {"—".repeat(item.depth)} {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Бренд</span>
        <select
          value={brand}
          onChange={(e) => update_params({ brand: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Все бренды</option>
          {filters.brands.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Объём</span>
        <select
          value={volume}
          onChange={(e) => update_params({ volume: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Любой объём</option>
          {filters.volumes.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">
          Тип упаковки
        </span>
        <select
          value={package_type}
          onChange={(e) =>
            update_params({ package_type: e.target.value || null })
          }
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Любая упаковка</option>
          {filters.package_types.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">
          Режим продажи
        </span>
        <select
          value={sales_status}
          onChange={(e) =>
            update_params({ sales_status: e.target.value || null })
          }
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="">Все</option>
          <option value="showcase">Витрина</option>
          <option value="on_request">Цена по запросу</option>
          <option value="orderable">Доступен для заказа</option>
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Наличие</span>
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
          <option value="out_of_stock">Нет в наличии</option>
        </select>
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={is_new}
            onChange={(e) =>
              update_params({ is_new: e.target.checked ? "true" : null })
            }
          />
          Только новинки
        </label>
        {approved ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={has_price}
              onChange={(e) =>
                update_params({
                  has_price: e.target.checked ? "true" : null,
                })
              }
            />
            Только с ценой
          </label>
        ) : null}
      </div>

      {has_filters ? (
        <button
          type="button"
          onClick={reset_filters}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          Сбросить фильтры
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-3 py-4 pb-24 sm:px-4 md:grid-cols-[260px_1fr] md:pb-8">
      <aside className="hidden md:block">
        <div className="sticky top-20 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Фильтры
            </h2>
            {filter_controls}
          </div>
        </div>
      </aside>

      <section ref={catalog_top_ref} className="space-y-4 scroll-mt-20">
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1 text-sm">
              <span className="mb-1 block font-medium text-slate-800">
                Поиск
              </span>
              <input
                value={search_input}
                onChange={(e) => set_search_input(e.target.value)}
                placeholder="Название, бренд, вкус или артикул"
                className="w-full rounded-md border border-slate-300 px-3 py-2.5"
                inputMode="search"
              />
            </label>
            <button
              type="button"
              className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 md:hidden"
              onClick={() => set_filters_open(true)}
            >
              Фильтры{has_filters ? " ·" : ""}
            </button>
          </div>

          {quick_categories.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Быстрые категории
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => update_params({ category: null })}
                  className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                    !category
                      ? "bg-teal-800 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Все
                </button>
                {quick_categories.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => update_params({ category: item.slug })}
                    className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                      category === item.slug || category === item.id
                        ? "bg-teal-800 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Сортировка</span>
              <select
                value={sort}
                onChange={(e) => update_params({ sort: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                {Object.entries(CATALOG_SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
                {CATALOG_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? <LoadingBlock label="Загрузка каталога…" /> : null}

        {error ? (
          <ErrorBlock
            message={error}
            on_retry={() => void load_products()}
          />
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
            <CatalogPagination
              placement="top"
              page={page}
              page_size={page_size}
              total={total}
              total_pages={total_pages}
              search_params={search_params}
              disabled={loading}
            />

            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={product}
                  on_quick_view={open_quick_view}
                />
              ))}
            </div>

            <CatalogPagination
              placement="bottom"
              page={page}
              page_size={page_size}
              total={total}
              total_pages={total_pages}
              search_params={search_params}
              disabled={loading}
              show_load_more
            />
          </>
        ) : null}

        {!approved && viewer !== "staff" ? (
          <p className="text-xs text-slate-500">
            Цены в каталоге скрыты для гостей. Условия подтвердит менеджер.{" "}
            <Link href="/login" className="text-teal-800 underline">
              Войти
            </Link>
          </p>
        ) : null}
      </section>

      {filters_open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Закрыть фильтры"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => set_filters_open(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Фильтры
              </h2>
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm text-slate-600"
                onClick={() => set_filters_open(false)}
              >
                Готово
              </button>
            </div>
            {filter_controls}
          </div>
        </div>
      ) : null}

      {quick_view_id ? (
        <CatalogQuickView
          product_id={quick_view_id}
          on_close={close_quick_view}
          return_focus_el={quick_view_return_focus_ref.current}
          has_product_page
        />
      ) : null}
    </div>
  );
}
