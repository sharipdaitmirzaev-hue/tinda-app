import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { list_public_catalog_categories } from "@/lib/services/products.service";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    const result = await list_public_catalog_categories(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("catalog categories error", error);
    return api_error(500, "internal_error", "Не удалось загрузить категории");
  }
}
