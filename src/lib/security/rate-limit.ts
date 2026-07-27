/**
 * Simple rate-limit adapter.
 *
 * Local in-memory implementation is for single-process development/tests.
 * Production with multiple instances MUST use a shared store (e.g. Redis).
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset_at_ms: number;
  retry_after_sec: number;
};

export type RateLimitStore = {
  hit(key: string, limit: number, window_ms: number): Promise<RateLimitResult>;
  /** Test helper */
  reset?(key?: string): void;
};

type Counter = { count: number; reset_at_ms: number };

function create_memory_store(): RateLimitStore {
  const buckets = new Map<string, Counter>();

  return {
    async hit(key, limit, window_ms) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.reset_at_ms <= now) {
        const reset_at_ms = now + window_ms;
        buckets.set(key, { count: 1, reset_at_ms });
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          reset_at_ms,
          retry_after_sec: Math.ceil(window_ms / 1000),
        };
      }

      current.count += 1;
      buckets.set(key, current);
      const allowed = current.count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - current.count),
        reset_at_ms: current.reset_at_ms,
        retry_after_sec: Math.max(
          1,
          Math.ceil((current.reset_at_ms - now) / 1000),
        ),
      };
    },
    reset(key) {
      if (!key) {
        buckets.clear();
        return;
      }
      buckets.delete(key);
    },
  };
}

let store: RateLimitStore = create_memory_store();

export function get_rate_limit_store(): RateLimitStore {
  return store;
}

/** Test / future Redis swap */
export function set_rate_limit_store_for_tests(next: RateLimitStore | null) {
  store = next ?? create_memory_store();
}

export function reset_rate_limit_store_for_tests() {
  store.reset?.();
  store = create_memory_store();
}

export const RATE_LIMITS = {
  login: { limit: 10, window_ms: 15 * 60 * 1000 },
  register: { limit: 5, window_ms: 60 * 60 * 1000 },
  upload_image: { limit: 30, window_ms: 60 * 60 * 1000 },
  create_order: { limit: 20, window_ms: 60 * 60 * 1000 },
} as const;

export async function consume_rate_limit(
  bucket: keyof typeof RATE_LIMITS,
  identity: string,
): Promise<RateLimitResult> {
  const cfg = RATE_LIMITS[bucket];
  const key = `${bucket}:${identity}`;
  return get_rate_limit_store().hit(key, cfg.limit, cfg.window_ms);
}

export function client_ip_from_headers(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
