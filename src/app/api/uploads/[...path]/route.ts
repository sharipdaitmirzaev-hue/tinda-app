import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { resolve_local_upload_path } from "@/lib/storage/product-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function content_type_for(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/**
 * Live filesystem serve for /uploads/* (via beforeFiles rewrite).
 * Avoids Next.js standalone startup cache missing newly written product images.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  if (!parts?.length) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const storage_key = parts.map((p) => decodeURIComponent(p)).join("/");
  const absolute = resolve_local_upload_path(storage_key);
  if (!absolute) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const stream = createReadStream(absolute);
    const web_stream = Readable.toWeb(stream) as unknown as ReadableStream;

    return new NextResponse(web_stream, {
      status: 200,
      headers: {
        "Content-Type": content_type_for(absolute),
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT") {
      return new NextResponse("Not Found", { status: 404 });
    }
    throw error;
  }
}
