import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { resolve_existing_local_upload_file } from "@/lib/storage/product-images";

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export function content_type_for_upload(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/**
 * Build a storage key from Next.js catch-all path segments.
 * Rejects empty segments and encoded traversal after decode.
 */
export function storage_key_from_upload_parts(
  parts: string[] | undefined,
): string | null {
  if (!parts?.length) {
    return null;
  }

  const decoded: string[] = [];
  for (const raw of parts) {
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("\0") ||
      part.includes("/") ||
      part.includes("\\") ||
      path.isAbsolute(part)
    ) {
      return null;
    }
    decoded.push(part);
  }

  return decoded.join("/");
}

/** Serve one local upload file or 404 (no directory listing). */
export async function serve_local_upload_response(
  parts: string[] | undefined,
): Promise<NextResponse> {
  const storage_key = storage_key_from_upload_parts(parts);
  if (!storage_key) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const absolute = await resolve_existing_local_upload_file(storage_key);
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
        "Content-Type": content_type_for_upload(absolute),
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=604800",
        "X-Content-Type-Options": "nosniff",
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
