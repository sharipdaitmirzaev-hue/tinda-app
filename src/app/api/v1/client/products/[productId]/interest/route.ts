import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { create_or_refresh_interest_request } from "@/lib/services/product-interest.service";
import { product_interest_create_schema } from "@/lib/validators/catalog";

type Params = { params: Promise<{ productId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { productId } = await params;
    const body = await request.json().catch(() => ({}));
    const input = product_interest_create_schema.parse(body);
    const result = await create_or_refresh_interest_request(
      payload,
      productId,
      input,
    );

    return NextResponse.json({
      request: result.request,
      already_registered: result.already_registered,
      message: result.message,
    });
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
    console.error("product interest create error", error);
    return api_error(500, "internal_error", "Не удалось отправить запрос");
  }
}
