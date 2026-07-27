/**
 * Shared offline-cache rules for the TINDA service worker.
 * Keep in sync with public/sw.js.
 */

export const CACHE_VERSION = "tinda-pwa-v1";
export const STATIC_CACHE = `${CACHE_VERSION}-static`;
export const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/favicon.png",
] as const;

/** Paths / prefixes that must never be cached (personal or auth-sensitive). */
export const NEVER_CACHE_PREFIXES = [
  "/api",
  "/login",
  "/register",
  "/cart",
  "/checkout",
  "/orders",
  "/staff",
  "/profile",
] as const;

export function is_never_cache_path(pathname: string): boolean {
  const path = pathname.split("?")[0] || "/";
  return NEVER_CACHE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function is_static_asset_path(pathname: string): boolean {
  const path = pathname.split("?")[0] || "/";
  if (path.startsWith("/_next/static/")) return true;
  if (path.startsWith("/icons/")) return true;
  if (path === "/favicon.ico" || path === "/favicon.png") return true;
  if (path === "/manifest.webmanifest") return true;
  return false;
}

/** Whether a same-origin GET may be stored in the offline cache. */
export function should_cache_same_origin_get(
  request_url: string,
  page_origin: string,
  method = "GET",
): boolean {
  if (method.toUpperCase() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(request_url, page_origin);
  } catch {
    return false;
  }
  if (url.origin !== new URL(page_origin).origin) return false;
  if (is_never_cache_path(url.pathname)) return false;
  return is_static_asset_path(url.pathname) || url.pathname === "/offline";
}
