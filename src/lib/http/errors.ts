import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "internal_error"
  | "rate_limited"
  | "ORDER_ALREADY_PROCESSED"
  | "ORDER_STATUS_CONFLICT";

export function api_error(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        // Zod field issues only — never stack traces / Prisma / secrets.
        ...(code === "validation_error" && details !== undefined
          ? { details }
          : {}),
      },
    },
    { status },
  );
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
