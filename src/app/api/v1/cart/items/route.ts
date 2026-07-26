import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { add_cart_item } from "@/lib/services/cart.service";
import { cart_add_item_schema } from "@/lib/validators/cart";

export async function POST(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const body = await request.json();
    const input = cart_add_item_schema.parse(body);
    const cart = await add_cart_item(payload, input);
    return NextResponse.json(cart);
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
    console.error("cart add item error", error);
    return api_error(500, "internal_error", "Не удалось добавить товар");
  }
}
