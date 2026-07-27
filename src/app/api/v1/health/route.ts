import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { safe_log_error } from "@/lib/security/redact";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "ok" });
  } catch (error) {
    safe_log_error("health check database unavailable", error);
    return NextResponse.json(
      { ok: false, database: "unavailable" },
      { status: 503 },
    );
  }
}
