import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { api_error } from "@/lib/http/errors";

export async function GET() {
  try {
    const items = await prisma.cities.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        region: true,
      },
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("cities error", error);
    return api_error(500, "internal_error", "Не удалось загрузить города");
  }
}
