import {
  UI_LOAD_ORDERS_ERROR,
} from "@/lib/i18n/ui-copy";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { AppError, api_error } from "@/lib/http/errors";
import { list_staff_orders } from "@/lib/services/order.service";
import { staff_orders_query_schema } from "@/lib/validators/orders";

export async function GET(request: Request) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }

    const url = new URL(request.url);
    const query = staff_orders_query_schema.parse({
      status: url.searchParams.get("status") ?? undefined,
      is_urgent: url.searchParams.get("is_urgent") ?? undefined,
      date_from: url.searchParams.get("date_from") ?? undefined,
      date_to: url.searchParams.get("date_to") ?? undefined,
      client_id: url.searchParams.get("client_id") ?? undefined,
      manager_id: url.searchParams.get("manager_id") ?? undefined,
      city_id: url.searchParams.get("city_id") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      page_size: url.searchParams.get("page_size") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });

    const result = await list_staff_orders(payload, query);
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
    console.error("list staff orders error", error);
    return api_error(500, "internal_error", UI_LOAD_ORDERS_ERROR);
  }
}
