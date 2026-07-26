import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, api_error } from "@/lib/http/errors";
import { create_session } from "@/lib/auth/session";
import { get_post_auth_path } from "@/lib/access";
import { login_user } from "@/lib/services/auth.service";
import { login_schema } from "@/lib/validators/auth";
import {
  client_ip_from_headers,
  consume_rate_limit,
} from "@/lib/security/rate-limit";
import { safe_log_error } from "@/lib/security/redact";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = login_schema.parse(body);
    const ip = client_ip_from_headers(request.headers);
    const login_key = `${ip}:${input.login.trim().toLowerCase()}`;

    const limit = await consume_rate_limit("login", login_key);
    if (!limit.allowed) {
      return api_error(
        429,
        "rate_limited",
        "Слишком много попыток входа. Попробуйте позже",
      );
    }

    const payload = await login_user(input);
    await create_session(payload.user.id);

    return NextResponse.json({
      ...payload,
      redirect_to: get_post_auth_path(payload),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const message =
        error.issues[0]?.message ?? "Проверьте правильность заполнения формы";
      return api_error(400, "validation_error", message, error.issues);
    }
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    safe_log_error("login error", error);
    return api_error(500, "internal_error", "Не удалось выполнить вход");
  }
}
