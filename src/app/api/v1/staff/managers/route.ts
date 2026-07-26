import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { has_role, is_staff } from "@/lib/access";
import { AppError, api_error } from "@/lib/http/errors";
import { list_active_managers } from "@/lib/services/registration-requests.service";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    if (!is_staff(payload.user.roles)) {
      return api_error(403, "forbidden", "Недостаточно прав для этого действия");
    }
    if (!has_role(payload.user.roles, "director")) {
      return api_error(403, "forbidden", "Список менеджеров доступен руководителю");
    }
    const items = await list_active_managers();
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("list managers error", error);
    return api_error(500, "internal_error", "Не удалось загрузить менеджеров");
  }
}
