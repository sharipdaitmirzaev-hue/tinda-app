/* TINDA service worker — keep cache rules aligned with src/lib/pwa/cache-policy.ts */
const CACHE_VERSION = "tinda-pwa-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/favicon.png",
];

const NEVER_CACHE_PREFIXES = [
  "/api",
  "/login",
  "/register",
  "/cart",
  "/checkout",
  "/orders",
  "/staff",
  "/profile",
];

function pathname_of(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function is_never_cache_path(pathname) {
  const path = pathname.split("?")[0] || "/";
  return NEVER_CACHE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function is_static_asset_path(pathname) {
  const path = pathname.split("?")[0] || "/";
  if (path.startsWith("/_next/static/")) return true;
  if (path.startsWith("/icons/")) return true;
  if (path === "/favicon.ico" || path === "/favicon.png") return true;
  if (path === "/manifest.webmanifest") return true;
  return false;
}

function should_cache_request(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (is_never_cache_path(url.pathname)) return false;
  return is_static_asset_path(url.pathname) || url.pathname === "/offline";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) await cache.put(url, response.clone());
          } catch {
            /* offline during install — ignore */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("tinda-pwa-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch API or personal navigations via cache.
  if (is_never_cache_path(url.pathname)) {
    return;
  }

  // Navigations: network-first, fall back to offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match("/offline");
          return (
            offline ||
            new Response(
              "Нет подключения к интернету. Проверьте сеть и попробуйте снова.",
              {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              },
            )
          );
        }
      })(),
    );
    return;
  }

  if (!should_cache_request(request)) {
    return;
  }

  // Static assets: stale-while-revalidate within allowlist only.
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      const network_promise = fetch(request)
        .then(async (response) => {
          if (response.ok && should_cache_request(request)) {
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        void network_promise;
        return cached;
      }

      const network = await network_promise;
      if (network) return network;
      return new Response("", { status: 504 });
    })(),
  );
});

// Expose helpers for unit tests that parse this file (optional).
self.__TINDA_PWA__ = {
  CACHE_VERSION,
  STATIC_CACHE,
  PRECACHE_URLS,
  is_never_cache_path,
  is_static_asset_path,
  should_cache_request,
  pathname_of,
};
