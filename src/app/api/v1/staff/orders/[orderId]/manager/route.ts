import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { assign_order_manager } from "@/lib/services/order.service";
import {
  assign_order_manager_schema,
  order_id_param_schema,
} from "@/lib/validators/orders";

type Params = { params: Promise<{ orderId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const { orderId } = await params;
    const order_id = order_id_param_schema.parse(orderId);
    const body = await request.json();
    const input = assign_order_manager_schema.parse(body);
    const result = await assign_order_manager(payload, order_id, input);
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
    console.error("assign order manager error", error);
    return api_error(500, "internal_error", "Не удалось назначить менеджера");
  }
}
