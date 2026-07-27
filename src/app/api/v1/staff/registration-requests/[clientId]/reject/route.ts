import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { reject_registration_request } from "@/lib/services/registration-requests.service";
import { reject_registration_request_schema } from "@/lib/validators/registration-requests";

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { clientId } = await context.params;
    const body = await request.json();
    const parsed = reject_registration_request_schema.parse(body);
    const result = await reject_registration_request(
      payload,
      clientId,
      parsed.reason,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Укажите причину отклонения",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("reject registration-request error", error);
    return api_error(500, "internal_error", "Не удалось отклонить заявку");
  }
}
