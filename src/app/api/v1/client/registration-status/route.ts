import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { get_registration_status } from "@/lib/services/client-status.service";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const status = await get_registration_status(payload);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("registration-status error", error);
    return api_error(500, "internal_error", "Не удалось получить статус заявки");
  }
}
