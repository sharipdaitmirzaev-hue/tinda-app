import { NextResponse } from "next/server";
import { destroy_session } from "@/lib/auth/session";
import { api_error } from "@/lib/http/errors";

export async function POST() {
  try {
    await destroy_session();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("logout error", error);
    return api_error(500, "internal_error", "Не удалось выйти из системы");
  }
}
