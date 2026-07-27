import sharp from "sharp";
import type { ImageProbeResult } from "@/lib/catalog/external-images/types";

const MIN_SIDE = 500;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function detect_format(
  buffer: Buffer,
): "jpeg" | "png" | "webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function normalize_mime(mime: string | null | undefined): string {
  return (mime || "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Heuristic watermark / banner / placeholder signals.
 * has_watermark=null means unknown — human must confirm.
 */
async function analyze_pixels(
  buffer: Buffer,
  width: number,
  height: number,
): Promise<{
  has_watermark: boolean | null;
  placeholder_like: boolean;
  background_hint: ImageProbeResult["background_hint"];
  low_quality: boolean;
  reasons: string[];
}> {
  const reasons: string[] = [];
  let placeholder_like = false;
  let low_quality = false;
  let background_hint: ImageProbeResult["background_hint"] = "unknown";

  if (width < MIN_SIDE || height < MIN_SIDE) {
    low_quality = true;
    reasons.push("below_500px");
  }
  if (buffer.length < 8_000) {
    placeholder_like = true;
    reasons.push("tiny_file");
  }

  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .resize(64, 64, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    let white = 0;
    let transparent = 0;
    let total = 0;
    // sample border
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        if (x > 2 && x < 61 && y > 2 && y < 61) continue;
        const i = (y * 64 + x) * channels;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = channels >= 4 ? (data[i + 3] ?? 255) : 255;
        total += 1;
        if (a < 30) transparent += 1;
        else if (r > 245 && g > 245 && b > 245) white += 1;
      }
    }
    if (total > 0) {
      const tw = transparent / total;
      const ww = white / total;
      if (tw >= 0.35) background_hint = "transparent";
      else if (ww >= 0.45) background_hint = "white";
      else background_hint = "other";
    }

    // very flat center might be banner/placeholder
    let sum = 0;
    let sum_sq = 0;
    let n = 0;
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) {
        const i = (y * 64 + x) * channels;
        const r = data[i] ?? 0;
        sum += r;
        sum_sq += r * r;
        n += 1;
      }
    }
    if (n > 0) {
      const mean = sum / n;
      const variance = sum_sq / n - mean * mean;
      if (variance < 40) {
        placeholder_like = true;
        reasons.push("flat_center");
      }
    }
  } catch {
    reasons.push("pixel_analysis_failed");
  }

  // Watermark cannot be reliably auto-detected without OCR.
  // Flat/placeholder images are flagged separately; leave watermark unknown for humans.
  const has_watermark = null;
  if (placeholder_like) reasons.push("possible_placeholder");

  return {
    has_watermark,
    placeholder_like,
    background_hint,
    low_quality,
    reasons,
  };
}

export async function probe_image_buffer(
  url: string,
  buffer: Buffer,
  mime_header: string | null,
  http_status: number,
): Promise<ImageProbeResult> {
  const reasons: string[] = [];
  const format = detect_format(buffer);
  const mime = normalize_mime(mime_header) || (format ? `image/${format === "jpeg" ? "jpeg" : format}` : null);

  if (!format) {
    return {
      ok: false,
      url,
      http_status,
      mime,
      format: null,
      width: null,
      height: null,
      bytes: buffer.length,
      has_watermark: null,
      low_quality: true,
      placeholder_like: true,
      background_hint: "unknown",
      reasons: ["not_an_image"],
    };
  }

  if (mime && !ALLOWED_MIME.has(mime) && !ALLOWED_MIME.has(`image/${format === "jpeg" ? "jpeg" : format}`)) {
    reasons.push("mime_not_allowed");
  }

  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(buffer, { failOn: "error" }).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    return {
      ok: false,
      url,
      http_status,
      mime,
      format,
      width: null,
      height: null,
      bytes: buffer.length,
      has_watermark: null,
      low_quality: true,
      placeholder_like: true,
      background_hint: "unknown",
      reasons: ["image_decode_failed"],
    };
  }

  const analysis = await analyze_pixels(buffer, width || 0, height || 0);
  reasons.push(...analysis.reasons);

  const ok =
    http_status >= 200 &&
    http_status < 300 &&
    !!format &&
    (width || 0) >= MIN_SIDE &&
    (height || 0) >= MIN_SIDE &&
    !analysis.placeholder_like;

  if (!ok && (width || 0) < MIN_SIDE) reasons.push("min_size_500");

  return {
    ok,
    url,
    http_status,
    mime,
    format,
    width,
    height,
    bytes: buffer.length,
    has_watermark: analysis.has_watermark,
    low_quality: analysis.low_quality,
    placeholder_like: analysis.placeholder_like,
    background_hint: analysis.background_hint,
    reasons,
  };
}

export async function fetch_and_probe_image(
  url: string,
  options?: { timeout_ms?: number; user_agent?: string },
): Promise<ImageProbeResult> {
  const timeout_ms = options?.timeout_ms ?? 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          options?.user_agent ||
          "TINDA-external-image-probe/1.0 (+https://tindagrupp.ru)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    const mime = res.headers.get("content-type");
    const buf = Buffer.from(await res.arrayBuffer());

    // CAPTCHA / block heuristics
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      return {
        ok: false,
        url,
        http_status: res.status,
        mime,
        format: null,
        width: null,
        height: null,
        bytes: buf.length,
        has_watermark: null,
        low_quality: true,
        placeholder_like: false,
        background_hint: "unknown",
        reasons: [`blocked_http_${res.status}`],
      };
    }
    const text_head = buf.slice(0, 200).toString("utf8").toLowerCase();
    if (
      text_head.includes("captcha") ||
      text_head.includes("<html") ||
      text_head.includes("cf-browser-verification")
    ) {
      return {
        ok: false,
        url,
        http_status: res.status,
        mime,
        format: null,
        width: null,
        height: null,
        bytes: buf.length,
        has_watermark: null,
        low_quality: true,
        placeholder_like: false,
        background_hint: "unknown",
        reasons: ["captcha_or_html_response"],
      };
    }

    return probe_image_buffer(url, buf, mime, res.status);
  } catch (e) {
    return {
      ok: false,
      url,
      http_status: null,
      mime: null,
      format: null,
      width: null,
      height: null,
      bytes: null,
      has_watermark: null,
      low_quality: true,
      placeholder_like: false,
      background_hint: "unknown",
      reasons: [e instanceof Error ? e.message : String(e)],
    };
  } finally {
    clearTimeout(timer);
  }
}
