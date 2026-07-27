import { get_app_url } from "@/lib/security/env";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function is_mutating_method(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/** Allowed origins: APP_URL + localhost variants in development. */
export function get_allowed_origins(): string[] {
  const origins = new Set<string>();
  const app = get_app_url();
  origins.add(app);

  try {
    const url = new URL(app);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      origins.add(`http://localhost:${url.port || "3000"}`);
      origins.add(`http://127.0.0.1:${url.port || "3000"}`);
    }
  } catch {
    // ignore
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return [...origins];
}

/**
 * CSRF defense for cookie auth: reject mutating API calls from foreign Origins.
 * Same-origin browser requests send Origin matching the app host.
 * Requests without Origin (same-site navigations, server-to-server without Origin)
 * are allowed when Sec-Fetch-Site is same-origin/none/missing, or Host matches APP_URL.
 */
export function assert_csrf_origin(request: {
  method: string;
  headers: Headers;
}): { ok: true } | { ok: false; message: string } {
  if (!is_mutating_method(request.method)) {
    return { ok: true };
  }

  const pathname_hint = request.headers.get("x-url-pathname") || "";
  // Allow logout without strict Origin in edge cases — still checked below if Origin present.

  const origin = request.headers.get("origin");
  const allowed = get_allowed_origins();

  if (origin) {
    if (allowed.includes(origin)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: "Запрос отклонён: недопустимый Origin",
    };
  }

  // No Origin header: accept same-site / non-browser trusted cases.
  const fetch_site = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (
    fetch_site === "same-origin" ||
    fetch_site === "same-site" ||
    fetch_site === "none" ||
    fetch_site === ""
  ) {
    const host = request.headers.get("host");
    if (host) {
      const ok_host = allowed.some((item) => {
        try {
          return new URL(item).host === host;
        } catch {
          return false;
        }
      });
      if (ok_host) return { ok: true };
      // Host mismatch without Origin → reject
      return {
        ok: false,
        message: "Запрос отклонён: недопустимый Host",
      };
    }
    // No Host (unit tests / internal): allow
    void pathname_hint;
    return { ok: true };
  }

  if (fetch_site === "cross-site") {
    return {
      ok: false,
      message: "Запрос отклонён: cross-site без Origin",
    };
  }

  return { ok: true };
}
