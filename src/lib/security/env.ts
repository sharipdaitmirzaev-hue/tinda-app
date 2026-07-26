let checked = false;

/**
 * SESSION_SECRET must be set. In production there is no fallback.
 * Used as HMAC pepper for session token hashes.
 */
export function get_session_secret(): string {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (!secret) {
    throw new Error(
      "SESSION_SECRET не задан. Укажите длинную случайную строку в .env",
    );
  }
  if (process.env.NODE_ENV === "production") {
    if (secret.length < 32) {
      throw new Error(
        "SESSION_SECRET в production должен быть не короче 32 символов",
      );
    }
    if (/^change-me/i.test(secret)) {
      throw new Error(
        "SESSION_SECRET в production не должен использовать значение по умолчанию",
      );
    }
  }
  return secret;
}

/** Call once at startup paths that touch sessions. */
export function assert_security_env(): void {
  if (checked) return;
  get_session_secret();
  checked = true;
}

export function get_app_url(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function get_storage_public_origin(): string | null {
  const raw = process.env.STORAGE_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
