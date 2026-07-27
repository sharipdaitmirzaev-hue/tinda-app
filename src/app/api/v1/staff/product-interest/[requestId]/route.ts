import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { update_interest_request_status } from "@/lib/services/product-interest.service";
import { staff_interest_status_schema } from "@/lib/validators/catalog";

type Params = { params: Promise<{ requestId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { requestId } = await params;
    const body = await request.json().catch(() => ({}));
    const input = staff_interest_status_schema.parse(body);
    const assign_self = Boolean(
      (body as { assign_self?: boolean }).assign_self,
    );

    const result = await update_interest_request_status(
      payload,
      requestId,
      input.status,
      { assign_self },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Некорректные данные",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("update product-interest error", error);
    return api_error(500, "internal_error", "Не удалось обновить запрос");
  }
}
