/**
 * Pure pagination range helpers for the public catalog.
 * No React / DOM — safe to unit-test in isolation.
 */

export type PaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; id: string };

/**
 * Build page numbers + ellipsis for a compact pager.
 *
 * Rules:
 * - totalPages <= 7 → all pages
 * - else: always first + last, current ±2, ellipsis for gaps
 * - never two ellipses in a row
 * - never duplicate page numbers
 */
export function getPaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return [];
  const total = Math.floor(totalPages);
  const current = Math.min(Math.max(1, Math.floor(currentPage) || 1), total);

  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => ({
      type: "page" as const,
      page: i + 1,
    }));
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  pages.add(current);
  for (let d = 1; d <= 2; d += 1) {
    if (current - d >= 1) pages.add(current - d);
    if (current + d <= total) pages.add(current + d);
  }

  // Keep a denser head/tail when near edges (matches examples 1 2 3 4 5 … N)
  if (current <= 4) {
    for (let p = 1; p <= 5; p += 1) pages.add(p);
  }
  if (current >= total - 3) {
    for (let p = total - 4; p <= total; p += 1) {
      if (p >= 1) pages.add(p);
    }
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  let prev = 0;
  let ellipsis_count = 0;
  for (const page of sorted) {
    if (prev > 0 && page - prev > 1) {
      ellipsis_count += 1;
      items.push({ type: "ellipsis", id: `e${ellipsis_count}` });
    }
    items.push({ type: "page", page });
    prev = page;
  }
  return items;
}

export function clampCatalogPage(
  page: number,
  totalPages: number,
  totalItems: number,
): number {
  if (!Number.isFinite(totalItems) || totalItems <= 0) return 1;
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 1;
  const safe = Math.floor(page) || 1;
  if (safe < 1) return 1;
  if (safe > totalPages) return totalPages;
  return safe;
}

export function formatCatalogResultsRange(options: {
  page: number;
  pageSize: number;
  total: number;
}): string {
  const { page, pageSize, total } = options;
  if (!Number.isFinite(total) || total <= 0) return "Товары не найдены";
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = Math.max(1, Math.floor(pageSize) || 1);
  const start = (safePage - 1) * safeSize + 1;
  const end = Math.min(safePage * safeSize, total);
  return `Показаны товары ${start}–${end} из ${total}`;
}

/** Catalog query keys preserved when only `page` changes. */
export const CATALOG_FILTER_QUERY_KEYS = [
  "q",
  "category",
  "category_id",
  "brand",
  "volume",
  "package_type",
  "sales_status",
  "availability",
  "is_new",
  "has_price",
  "sort",
  "page_size",
] as const;

/**
 * Build a catalog href that keeps all active filters and only sets `page`.
 * Empty / null values are omitted. page=1 may still be set explicitly.
 */
export function buildCatalogPageHref(
  searchParams: Pick<URLSearchParams, "get"> | Record<string, string | null | undefined>,
  page: number,
): string {
  const source =
    typeof (searchParams as URLSearchParams).get === "function"
      ? (searchParams as Pick<URLSearchParams, "get">)
      : new URLSearchParams(
          Object.entries(searchParams as Record<string, string | null | undefined>)
            .filter(([, v]) => v != null && String(v) !== "")
            .map(([k, v]) => [k, String(v)]),
        );

  const params = new URLSearchParams();
  for (const key of CATALOG_FILTER_QUERY_KEYS) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const safePage = Math.max(1, Math.floor(page) || 1);
  params.set("page", String(safePage));

  const query = params.toString();
  return `/catalog?${query}`;
}
