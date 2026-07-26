import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { get_registration_request } from "@/lib/services/registration-requests.service";

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { clientId } = await context.params;
    const result = await get_registration_request(payload, clientId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("get registration-request error", error);
    return api_error(500, "internal_error", "Не удалось загрузить заявку");
  }
}
