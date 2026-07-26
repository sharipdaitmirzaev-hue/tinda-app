import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { confirm_staff_order } from "@/lib/services/order.service";
import {
  order_id_param_schema,
  staff_confirm_order_schema,
} from "@/lib/validators/orders";

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const { orderId } = await params;
    const order_id = order_id_param_schema.parse(orderId);
    const body = await request.json().catch(() => ({}));
    const input = staff_confirm_order_schema.parse(body);
    const result = await confirm_staff_order(payload, order_id, input);
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
    console.error("confirm staff order error", error);
    return api_error(500, "internal_error", "Не удалось подтвердить заказ");
  }
}
