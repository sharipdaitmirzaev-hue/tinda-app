import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { get_catalog_product } from "@/lib/services/products.service";

type RouteContext = { params: Promise<{ productId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const { productId } = await context.params;
    const result = await get_catalog_product(payload, productId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("catalog product error", error);
    return api_error(500, "internal_error", "Не удалось загрузить товар");
  }
}
