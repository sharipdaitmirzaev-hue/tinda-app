import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { clear_cart, get_cart } from "@/lib/services/cart.service";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const cart = await get_cart(payload);
    return NextResponse.json(cart);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("cart get error", error);
    return api_error(500, "internal_error", "Не удалось загрузить корзину");
  }
}

export async function DELETE() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const cart = await clear_cart(payload);
    return NextResponse.json(cart);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("cart clear error", error);
    return api_error(500, "internal_error", "Не удалось очистить корзину");
  }
}
