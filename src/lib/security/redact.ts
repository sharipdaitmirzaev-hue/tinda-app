const SENSITIVE_KEY =
  /pass(word)?|secret|token|cookie|authorization|access_key|secret_key|session/i;

export function redact_value(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redact_value(String(index), item));
  }
  if (value && typeof value === "object") {
    return redact_object(value as Record<string, unknown>);
  }
  return value;
}

export function redact_object(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = redact_value(key, value);
  }
  return out;
}

/** Safe server logging — never dumps passwords/tokens/secrets. */
export function safe_log_error(label: string, error: unknown, meta?: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  const name = error instanceof Error ? error.name : undefined;
  console.error(label, {
    name,
    message,
    ...(meta && typeof meta === "object"
      ? { meta: redact_object(meta as Record<string, unknown>) }
      : {}),
  });
}
