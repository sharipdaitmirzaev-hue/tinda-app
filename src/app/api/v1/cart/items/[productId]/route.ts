import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import {
  remove_cart_item,
  update_cart_item,
} from "@/lib/services/cart.service";
import {
  cart_product_id_param_schema,
  cart_update_item_schema,
} from "@/lib/validators/cart";

type Params = { params: Promise<{ productId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { productId } = await params;
    const product_id = cart_product_id_param_schema.parse(productId);
    const body = await request.json();
    const input = cart_update_item_schema.parse(body);
    const cart = await update_cart_item(payload, product_id, input.qty);
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
    console.error("cart update item error", error);
    return api_error(500, "internal_error", "Не удалось изменить количество");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const { productId } = await params;
    const product_id = cart_product_id_param_schema.parse(productId);
    const cart = await remove_cart_item(payload, product_id);
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
    console.error("cart remove item error", error);
    return api_error(500, "internal_error", "Не удалось удалить позицию");
  }
}
