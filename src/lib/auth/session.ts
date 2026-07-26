import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE_NAME = "tinda_session";
const SESSION_DAYS = 14;

function hash_token(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
  cookie_store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expires_at,
  });
}

export async function destroy_session(): Promise<void> {
  const cookie_store = await cookies();
  const token = cookie_store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const token_hash = hash_token(token);
    await prisma.sessions.deleteMany({ where: { token_hash } });
  }

  cookie_store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function get_session_user_id(): Promise<string | null> {
  const cookie_store = await cookies();
  const token = cookie_store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const token_hash = hash_token(token);
  const session = await prisma.sessions.findUnique({
    where: { token_hash },
    select: { user_id: true, expires_at: true },
  });

  if (!session) {
    return null;
  }

  if (session.expires_at.getTime() < Date.now()) {
    await prisma.sessions.deleteMany({ where: { token_hash } });
    cookie_store.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    return null;
  }

  return session.user_id;
}
