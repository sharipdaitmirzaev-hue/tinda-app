import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  assert_security_env,
  get_app_url,
  get_session_secret,
} from "@/lib/security/env";

export const SESSION_COOKIE_NAME = "tinda_session";
const SESSION_DAYS = 14;

function hash_token(token: string): string {
  assert_security_env();
  return createHmac("sha256", get_session_secret()).update(token).digest("hex");
}

/** Secure cookies only when the public app URL is HTTPS (HTTP-by-IP deploys need Secure=false). */
function cookie_secure(): boolean {
  const override = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return get_app_url().startsWith("https://");
}

function session_cookie_options(expires: Date) {
  return {
    httpOnly: true as const,
    secure: cookie_secure(),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

function session_expiry_date(): Date {
  const expires_at = new Date();
  expires_at.setDate(expires_at.getDate() + SESSION_DAYS);
  return expires_at;
}

export async function create_session(user_id: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const token_hash = hash_token(token);
  const expires_at = session_expiry_date();

  await prisma.sessions.create({
    data: {
      user_id,
      token_hash,
      expires_at,
    },
  });

  const cookie_store = await cookies();
  cookie_store.set(
    SESSION_COOKIE_NAME,
    token,
    session_cookie_options(expires_at),
  );
}

export async function destroy_session(): Promise<void> {
  const cookie_store = await cookies();
  const token = cookie_store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      const token_hash = hash_token(token);
      await prisma.sessions.deleteMany({ where: { token_hash } });
    } catch {
      // Invalid secret / env during logout — still clear cookie.
    }
  }

  cookie_store.set(
    SESSION_COOKIE_NAME,
    "",
    session_cookie_options(new Date(0)),
  );
}

export async function get_session_user_id(): Promise<string | null> {
  const cookie_store = await cookies();
  const token = cookie_store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  let token_hash: string;
  try {
    token_hash = hash_token(token);
  } catch {
    return null;
  }

  const session = await prisma.sessions.findUnique({
    where: { token_hash },
    select: { user_id: true, expires_at: true },
  });

  if (!session) {
    return null;
  }

  if (session.expires_at.getTime() < Date.now()) {
    await prisma.sessions.deleteMany({ where: { token_hash } });
    cookie_store.set(
      SESSION_COOKIE_NAME,
      "",
      session_cookie_options(new Date(0)),
    );
    return null;
  }

  return session.user_id;
}
