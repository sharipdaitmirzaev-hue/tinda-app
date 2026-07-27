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
    if (/^change-me/i.test(secret) || /dev-change-me/i.test(secret)) {
      throw new Error(
        "SESSION_SECRET в production не должен использовать значение по умолчанию",
      );
    }
  }
  return secret;
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

function require_env(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`${name} обязателен в production`);
  }
  return value;
}

/** Full production env validation (startup). */
export function assert_production_env(): void {
  require_env("DATABASE_URL");
  get_session_secret();
  require_env("APP_URL");

  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (driver !== "local" && driver !== "s3") {
    throw new Error("STORAGE_DRIVER должен быть local или s3");
  }
  if (driver === "s3") {
    for (const key of [
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY",
      "STORAGE_SECRET_KEY",
      "STORAGE_PUBLIC_URL",
    ]) {
      require_env(key);
    }
  }
}

/** Call once at startup paths that touch sessions / production boot. */
export function assert_security_env(): void {
  if (checked) return;
  if (process.env.NODE_ENV === "production") {
    assert_production_env();
  } else {
    get_session_secret();
  }
  checked = true;
}
