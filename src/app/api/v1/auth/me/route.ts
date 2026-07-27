import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { get_post_auth_path } from "@/lib/access";
import { api_error } from "@/lib/http/errors";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    return NextResponse.json({
      ...payload,
      redirect_to: get_post_auth_path(payload),
    });
  } catch (error) {
    console.error("me error", error);
    return api_error(500, "internal_error", "Не удалось получить пользователя");
  }
}
