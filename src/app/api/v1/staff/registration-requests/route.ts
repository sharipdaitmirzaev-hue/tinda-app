import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { list_registration_requests } from "@/lib/services/registration-requests.service";
import { list_registration_requests_query_schema } from "@/lib/validators/registration-requests";

export async function GET(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const url = new URL(request.url);
    const parsed = list_registration_requests_query_schema.parse({
      status: url.searchParams.get("status") ?? undefined,
      city_id: url.searchParams.get("city_id") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      page_size: url.searchParams.get("page_size") ?? undefined,
    });

    const result = await list_registration_requests(payload, parsed);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return api_error(
        400,
        "validation_error",
        error.issues[0]?.message ?? "Некорректные параметры запроса",
        error.issues,
      );
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("list registration-requests error", error);
    return api_error(500, "internal_error", "Не удалось загрузить заявки");
  }
}
