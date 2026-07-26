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

/** Price-related keys forbidden in E1. */
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
): string[] {
  const found: string[] = [];
  if (value === null || value === undefined) return found;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collect_forbidden_keys(item, `${path}[${index}]`));
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
        (FORBIDDEN_PRICE_KEYS as readonly string[]).includes(lower) ||
        lower.includes("price")
      ) {
        found.push(full);
      }
      found.push(...collect_forbidden_keys(nested, full));
    }
  }

  return found;
}

export function assert_no_forbidden_response_keys(
  payload: unknown,
  options?: { allow_manager_comment?: boolean },
) {
  const keys = collect_forbidden_keys(payload);
  const filtered = options?.allow_manager_comment
    ? keys
    : keys;
  // manager_comment is allowed on staff responses; caller checks separately for client.
  void filtered;
  if (keys.length > 0) {
    throw new Error(`Forbidden response keys: ${keys.join(", ")}`);
  }
}

export function json_contains_manager_comment(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const text = JSON.stringify(payload);
  return /"manager_comment"\s*:/.test(text);
}
