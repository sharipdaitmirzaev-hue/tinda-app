import { get_storage_public_origin } from "@/lib/security/env";

export function build_content_security_policy(): string {
  const img_sources = ["'self'", "data:", "blob:"];
  const storage_origin = get_storage_public_origin();
  if (storage_origin) {
    img_sources.push(storage_origin);
  }
  // Allow https images for manual image_url links in catalog.
  img_sources.push("https:");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // Next.js requires inline scripts/styles in many setups.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img_sources.join(" ")}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    // PWA service worker
    "worker-src 'self'",
    "manifest-src 'self'",
  ];

  return directives.join("; ");
}

export function apply_security_headers(
  headers: Headers,
  options?: { is_production?: boolean },
) {
  const is_production =
    options?.is_production ?? process.env.NODE_ENV === "production";

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", build_content_security_policy());

  if (is_production) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}
