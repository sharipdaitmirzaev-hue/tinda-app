import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { create_order_from_cart } from "@/lib/services/order.service";
import {
  create_order_schema,
  idempotency_key_schema,
} from "@/lib/validators/orders";

export async function POST(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const idempotency_header = request.headers.get("Idempotency-Key");
    if (!idempotency_header) {
      return api_error(
        400,
        "validation_error",
        "Не удалось отправить заказ. Попробуйте ещё раз",
      );
    }

    const idempotency_key = idempotency_key_schema.parse(idempotency_header);
    const body = await request.json();
    const input = create_order_schema.parse(body);
    const result = await create_order_from_cart(
      payload,
      input,
      idempotency_key,
    );
    return NextResponse.json(result, { status: 201 });
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
    console.error("create order error", error);
    return api_error(
      500,
      "internal_error",
      "Не удалось отправить заказ. Попробуйте ещё раз",
    );
  }
}
