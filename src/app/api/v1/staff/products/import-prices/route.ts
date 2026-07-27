import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { import_product_prices_from_workbook } from "@/lib/services/product-price-import.service";

export async function POST(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return api_error(400, "validation_error", "Прикрепите Excel-файл (file)");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return api_error(400, "validation_error", "Файл пустой");
    }

    const result = await import_product_prices_from_workbook(payload, buffer);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("price import error", error);
    return api_error(500, "internal_error", "Не удалось импортировать цены");
  }
}
