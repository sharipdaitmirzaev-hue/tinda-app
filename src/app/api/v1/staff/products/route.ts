import {
  UI_LOAD_PRODUCTS_ERROR,
} from "@/lib/i18n/ui-copy";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import {
  create_product,
  list_staff_products,
} from "@/lib/services/products.service";
import {
  product_create_schema,
  staff_products_query_schema,
} from "@/lib/validators/catalog";

export async function GET(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const url = new URL(request.url);
    const query = staff_products_query_schema.parse({
      q: url.searchParams.get("q") ?? undefined,
      category_id: url.searchParams.get("category_id") ?? undefined,
      availability: url.searchParams.get("availability") ?? undefined,
      is_active: url.searchParams.get("is_active") ?? undefined,
      is_promo: url.searchParams.get("is_promo") ?? undefined,
      is_new: url.searchParams.get("is_new") ?? undefined,
      is_hit: url.searchParams.get("is_hit") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      page_size: url.searchParams.get("page_size") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });
    const result = await list_staff_products(payload, query);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Некорректные параметры",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff products list error", error);
    return api_error(500, "internal_error", UI_LOAD_PRODUCTS_ERROR);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const body = await request.json();
    const input = product_create_schema.parse(body);
    const result = await create_product(payload, input);
    return NextResponse.json(result, { status: 201 });
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
    console.error("staff products create error", error);
    return api_error(500, "internal_error", "Не удалось создать товар");
  }
}
