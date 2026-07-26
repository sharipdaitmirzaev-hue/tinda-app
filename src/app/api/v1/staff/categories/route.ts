import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import {
  create_category,
  list_staff_categories,
} from "@/lib/services/categories.service";
import { category_create_schema } from "@/lib/validators/catalog";

export async function GET() {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const result = await list_staff_categories(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff categories list error", error);
    return api_error(500, "internal_error", "Не удалось загрузить категории");
  }
}

export async function POST(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    const body = await request.json();
    const input = category_create_schema.parse(body);
    const result = await create_category(payload, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Проверьте данные категории",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff categories create error", error);
    return api_error(500, "internal_error", "Не удалось создать категорию");
  }
}
