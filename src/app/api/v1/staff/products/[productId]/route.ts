import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import {
  get_staff_product,
  update_product,
} from "@/lib/services/products.service";
import { product_update_schema } from "@/lib/validators/catalog";

type RouteContext = { params: Promise<{ productId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const { productId } = await context.params;
    const result = await get_staff_product(payload, productId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff product get error", error);
    return api_error(500, "internal_error", "Не удалось загрузить товар");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const { productId } = await context.params;
    const body = await request.json();
    const input = product_update_schema.parse(body);
    const result = await update_product(payload, productId, input);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Проверьте данные товара",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff product update error", error);
    return api_error(500, "internal_error", "Не удалось сохранить товар");
  }
}
