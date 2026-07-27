/** Keys that must never appear in API JSON responses. */
export const FORBIDDEN_RESPONSE_KEYS = [
  "password",
  "password_hash",
  "session_token",
  "token_hash",
  "storage_secret_key",
  "STORAGE_SECRET_KEY",
  "STORAGE_ACCESS_KEY",
  "SESSION_SECRET",
  "accessKeyId",
  "secretAccessKey",
] as const;

/**
 * Internal / cost fields that must never leak to clients.
 * Wholesale `price` for approved clients / staff is allowed when
 * `allow_client_price` is true.
 */
export const FORBIDDEN_INTERNAL_PRICE_KEYS = [
  "purchase_price",
  "cost_price",
  "supplier_price",
  "margin",
  "price_cents",
] as const;

/** @deprecated Use FORBIDDEN_INTERNAL_PRICE_KEYS + allow_client_price option. */
export const FORBIDDEN_PRICE_KEYS = [
  "price",
  "price_rub",
  "price_cents",
  "unit_price",
  "total_price",
  "amount",
] as const;

export function collect_forbidden_keys(
  value: unknown,
  path = "",
  options?: { allow_client_price?: boolean },
): string[] {
  const found: string[] = [];
  const allow_client_price = options?.allow_client_price === true;
  if (value === null || value === undefined) return found;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(
        ...collect_forbidden_keys(item, `${path}[${index}]`, options),
      );
    });
    return found;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const full = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (
        (FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key) ||
        lower === "password" ||
        lower === "password_hash" ||
        lower === "token_hash" ||
        lower === "session_token"
      ) {
        found.push(full);
      }

      if (
        (FORBIDDEN_INTERNAL_PRICE_KEYS as readonly string[]).includes(lower)
      ) {
        found.push(full);
      }

      if (!allow_client_price) {
        if (
          (FORBIDDEN_PRICE_KEYS as readonly string[]).includes(lower) ||
          lower.includes("price") ||
          lower === "subtotal" ||
          lower === "line_total" ||
          lower === "delivery_total" ||
          lower === "unit_price"
        ) {
          // Note: bare "total" is allowed — catalog pagination uses it.
          found.push(full);
        }
      }

      found.push(...collect_forbidden_keys(nested, full, options));
    }
  }

  return found;
}

export function assert_no_forbidden_response_keys(
  payload: unknown,
  options?: { allow_manager_comment?: boolean; allow_client_price?: boolean },
) {
  const keys = collect_forbidden_keys(payload, "", {
    allow_client_price: options?.allow_client_price,
  });
  void options?.allow_manager_comment;
  if (keys.length > 0) {
    throw new Error(`Forbidden response keys: ${keys.join(", ")}`);
  }
}

export function json_contains_manager_comment(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const text = JSON.stringify(payload);
  return /"manager_comment"\s*:/.test(text);
}
