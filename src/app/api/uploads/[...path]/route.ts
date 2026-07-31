import { serve_local_upload_response } from "@/lib/storage/serve-local-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live filesystem serve for /uploads/* (via beforeFiles rewrite).
 * Avoids Next.js standalone startup cache missing newly written product images.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  return serve_local_upload_response(parts);
}
