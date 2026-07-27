/**
 * Catalog quick-view URL helpers (pure — unit-testable).
 */

export const QUICK_VIEW_PARAM = "quick_view";

/** Catalog filters / paging keys preserved when toggling quick_view. */
export const CATALOG_QUERY_KEYS_KEEP = [
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
  "page",
  "page_size",
] as const;

export function buildCatalogHrefWithQuickView(
  searchParams: Pick<URLSearchParams, "get"> | URLSearchParams,
  productId: string | null,
): string {
  const params = new URLSearchParams();
  for (const key of CATALOG_QUERY_KEYS_KEEP) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (productId) params.set(QUICK_VIEW_PARAM, productId);
  else params.delete(QUICK_VIEW_PARAM);
  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
}

export function readQuickViewId(
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  const raw = searchParams.get(QUICK_VIEW_PARAM);
  if (!raw) return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}
