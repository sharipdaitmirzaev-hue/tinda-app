export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assert_security_env } = await import("@/lib/security/env");
    assert_security_env();
  }
}
