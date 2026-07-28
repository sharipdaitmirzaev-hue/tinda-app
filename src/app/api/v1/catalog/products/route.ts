import {
  UI_LOAD_PRODUCTS_ERROR,
} from "@/lib/i18n/ui-copy";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { list_catalog_products } from "@/lib/services/products.service";
import { catalog_products_query_schema } from "@/lib/validators/catalog";

export async function GET(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    const url = new URL(request.url);
    const query = catalog_products_query_schema.parse({
      q: url.searchParams.get("q") ?? undefined,
      category_id: url.searchParams.get("category_id") ?? undefined,
      availability: url.searchParams.get("availability") ?? undefined,
      is_promo: url.searchParams.get("is_promo") ?? undefined,
      is_new: url.searchParams.get("is_new") ?? undefined,
      is_hit: url.searchParams.get("is_hit") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      page_size: url.searchParams.get("page_size") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });
    const result = await list_catalog_products(payload, query);
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
    console.error("catalog products error", error);
    return api_error(500, "internal_error", UI_LOAD_PRODUCTS_ERROR);
  }
}
