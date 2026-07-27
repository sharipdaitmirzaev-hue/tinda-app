#!/usr/bin/env node
/**
 * Download ALL «Зелёное яблоко» candidate images locally.
 *
 * Input: data/imports/zelenoe_yabloko_gazirovannye_candidates.json
 * Does NOT use approval.xlsx.
 * Does NOT change production / VPS / DB / image_url.
 * Does NOT run product-images staging.
 *
 * Output:
 *   data/imports/zelenoe-yabloko-images/original/
 *   data/imports/zelenoe-yabloko-images/previews/
 *   data/imports/zelenoe-yabloko-images/manifest.json
 *   data/imports/zelenoe-yabloko-images/gallery.html
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { translit } from "../../src/lib/catalog/external-images/normalize";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const USER_AGENT =
  "TINDA-zelenoe-images/1.0 (+https://tindagrupp.ru; local-archive-only)";

type Candidate = {
  source_site?: string;
  source_product_url: string;
  source_name: string;
  brand?: string;
  flavor?: string;
  volume_text?: string;
  package_type?: string;
  candidate_image_url: string;
  source_brand?: string;
  source_flavor?: string;
  source_volume?: string;
  source_package?: string;
};

type ManifestRow = {
  source_index: number;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  source_product_url: string;
  candidate_image_url: string;
  local_original_path: string;
  local_preview_path: string;
  mime_type: string;
  extension: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  sha256: string;
  match_status: string;
  tinda_sku: string;
  download_status: "ok" | "error" | "duplicate" | "skipped";
  error_message: string;
  duplicate_of: string;
  review_status: "pending";
};

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safe_token(value: string, max = 40): string {
  const t = translit(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return t || "x";
}

function volume_token(volume_text: string): string {
  const t = String(volume_text || "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)(мл|л|ml|l)?/);
  if (!m) return "vol";
  const n = m[1].replace(".", "p");
  const u = (m[2] || "").replace("мл", "ml").replace("л", "l") || "";
  return `${n}${u}` || "vol";
}

function detect_format(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function ext_of(format: "jpeg" | "png" | "webp"): string {
  return format === "jpeg" ? "jpg" : format;
}

function mime_of(format: "jpeg" | "png" | "webp"): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function assert_not_blocked(status: number, buf: Buffer, url: string) {
  if (status === 403 || status === 429 || status === 503) {
    throw new Error(`BLOCKED http_${status} at ${url}`);
  }
  const head = buf.slice(0, 400).toString("utf8").toLowerCase();
  if (
    head.includes("captcha") ||
    head.includes("smartcaptcha") ||
    head.includes("cf-browser-verification") ||
    head.includes("<html") ||
    head.includes("<!doctype")
  ) {
    throw new Error(`CAPTCHA_or_HTML at ${url}`);
  }
}

/** CDN sometimes blocks /webp/files/* while /files/* is public. */
function image_url_fallbacks(url: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(url);
  if (url.includes("/webp/files/")) {
    push(url.replace("/webp/files/", "/files/"));
  }
  if (url.includes("/webp/cropped/")) {
    push(url.replace("/webp/cropped/", "/cropped/"));
  }
  return out;
}

async function fetch_image_buffer(url: string): Promise<{
  url: string;
  buf: Buffer;
  status: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://zelenoeyabloko.ru/",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { url, buf, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function load_match_map(review_path: string | null): Map<
  string,
  { match_status: string; tinda_sku: string }
> {
  const map = new Map<string, { match_status: string; tinda_sku: string }>();
  if (!review_path || !existsSync(review_path)) return map;
  const wb = XLSX.readFile(review_path);
  const priority: Record<string, number> = {
    exact_match: 4,
    conflict: 3,
    probable_match: 2,
    new_product: 1,
    no_match: 0,
  };
  for (const name of wb.SheetNames) {
    if (name === "Инструкция") continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      defval: "",
    }) as Record<string, unknown>[];
    for (const r of rows) {
      const url = String(r.candidate_image_url || "").trim();
      if (!url) continue;
      let status = String(r.match_status || "").trim() || "unknown";
      if (name === "Новые товары") status = "new_product";
      const sku = String(r.tinda_sku || "").trim();
      const prev = map.get(url);
      if (
        !prev ||
        (priority[status] ?? -1) > (priority[prev.match_status] ?? -1)
      ) {
        map.set(url, { match_status: status, tinda_sku: sku });
      }
    }
  }
  return map;
}

function escape_html(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function build_gallery_html(rows: ManifestRow[], title: string): string {
  const cards = rows
    .map((r) => {
      const img =
        r.local_preview_path ||
        r.local_original_path ||
        "";
      void img;
      const preview_rel = r.local_preview_path
        ? `previews/${path.basename(r.local_preview_path)}`
        : r.local_original_path
          ? `original/${path.basename(r.local_original_path)}`
          : "";
      return `<article class="card" data-status="${escape_html(r.match_status)}">
  <div class="photo">${
    preview_rel
      ? `<img src="${escape_html(preview_rel)}" alt="${escape_html(r.source_name)}" loading="lazy" />`
      : `<div class="missing">no image</div>`
  }</div>
  <h2>${escape_html(r.source_name)}</h2>
  <dl>
    <div><dt>Бренд</dt><dd>${escape_html(r.brand)}</dd></div>
    <div><dt>Вкус</dt><dd>${escape_html(r.flavor || "—")}</dd></div>
    <div><dt>Объём</dt><dd>${escape_html(r.volume_text || "—")}</dd></div>
    <div><dt>Упаковка</dt><dd>${escape_html(r.package_type || "—")}</dd></div>
    <div><dt>match_status</dt><dd><span class="badge">${escape_html(r.match_status)}</span></dd></div>
    <div><dt>TINDA SKU</dt><dd>${escape_html(r.tinda_sku || "—")}</dd></div>
    <div><dt>Размер</dt><dd>${r.width && r.height ? `${r.width}×${r.height}` : "—"} / ${r.file_size ?? "—"} B</dd></div>
    <div><dt>review_status</dt><dd><span class="pending">pending</span></dd></div>
    <div><dt>download</dt><dd>${escape_html(r.download_status)}${r.error_message ? ` — ${escape_html(r.error_message)}` : ""}${r.duplicate_of ? ` (dup of #${escape_html(r.duplicate_of)})` : ""}</dd></div>
  </dl>
  <a class="src" href="${escape_html(r.source_product_url)}" target="_blank" rel="noopener">Карточка источника</a>
</article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape_html(title)}</title>
<style>
  :root { --bg:#f3f1ea; --ink:#1c1a16; --muted:#5c574e; --line:#d9d2c4; --accent:#2f6b3a; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", "Helvetica Neue", sans-serif; background:
    radial-gradient(circle at 10% 0%, #e8f0df, transparent 40%),
    radial-gradient(circle at 90% 10%, #efe6d6, transparent 35%),
    var(--bg); color: var(--ink); }
  header { padding: 28px 24px 12px; max-width: 1200px; margin: 0 auto; }
  header h1 { margin: 0 0 8px; font-size: 1.6rem; letter-spacing: -0.02em; }
  header p { margin: 0; color: var(--muted); }
  .grid { max-width: 1200px; margin: 0 auto; padding: 16px 24px 48px;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .card { background: rgba(255,255,255,0.72); border: 1px solid var(--line); border-radius: 16px;
    padding: 12px; display: flex; flex-direction: column; gap: 8px; backdrop-filter: blur(4px); }
  .photo { aspect-ratio: 1; background: #fff; border-radius: 12px; overflow: hidden;
    display:grid; place-items:center; border: 1px solid var(--line); }
  .photo img { width:100%; height:100%; object-fit: contain; }
  .missing { color: var(--muted); font-size: 0.9rem; }
  h2 { font-size: 0.98rem; line-height: 1.3; margin: 0; min-height: 2.6em; }
  dl { margin: 0; display: grid; gap: 4px; }
  dl > div { display: grid; grid-template-columns: 110px 1fr; gap: 6px; font-size: 0.82rem; }
  dt { color: var(--muted); }
  dd { margin: 0; word-break: break-word; }
  .badge { display:inline-block; padding: 1px 8px; border-radius: 999px; background:#e7efe6; color: var(--accent); font-weight: 600; }
  .pending { color: #8a5a00; font-weight: 600; }
  a.src { color: var(--accent); font-size: 0.85rem; text-decoration: none; margin-top: auto; }
  a.src:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>${escape_html(title)}</h1>
  <p>Локальный архив кандидатов «Зелёное яблоко». review_status = pending. Production не изменён.</p>
</header>
<main class="grid">
${cards}
</main>
</body>
</html>`;
}

async function main() {
  if (process.argv.includes("--apply-production")) {
    throw new Error("Production apply is disabled.");
  }

  const candidates_path = path.resolve(
    arg("candidates", "data/imports/zelenoe_yabloko_gazirovannye_candidates.json")!,
  );
  const review_path = arg(
    "review",
    "data/imports/zelenoe_yabloko_gazirovannye_images_review.xlsx",
  );
  const out_root = path.resolve(
    arg("out-dir", "data/imports/zelenoe-yabloko-images")!,
  );
  const delay_ms = Number(arg("delay-ms", "600"));
  const original_dir = path.join(out_root, "original");
  const preview_dir = path.join(out_root, "previews");
  mkdirSync(original_dir, { recursive: true });
  mkdirSync(preview_dir, { recursive: true });

  const candidates_raw = JSON.parse(
    readFileSync(candidates_path, "utf8"),
  );
  const candidates = (
    Array.isArray(candidates_raw)
      ? candidates_raw
      : candidates_raw.candidates || []
  ) as Candidate[];
  const match_map = load_match_map(
    review_path ? path.resolve(review_path) : null,
  );

  const sha_to_index = new Map<string, number>();
  const rows: ManifestRow[] = [];
  let downloaded = 0;
  let errors = 0;
  let duplicates = 0;
  let below_500 = 0;
  let total_bytes = 0;
  let urls_processed = 0;

  console.error(`[zy-dl] candidates=${candidates.length}`);

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    const source_index = i + 1;
    const brand = c.brand || c.source_brand || "";
    const flavor = c.flavor || c.source_flavor || "";
    const volume_text = c.volume_text || c.source_volume || "";
    const package_type = c.package_type || c.source_package || "";
    const url = String(c.candidate_image_url || "").trim();
    const match = match_map.get(url) || {
      match_status: "unknown",
      tinda_sku: "",
    };

    const base_name = [
      String(source_index).padStart(2, "0"),
      safe_token(brand, 20),
      safe_token(c.source_name, 48),
      volume_token(volume_text),
    ].join("_");

    const row: ManifestRow = {
      source_index,
      source_name: c.source_name,
      brand,
      flavor,
      volume_text,
      package_type,
      source_product_url: c.source_product_url,
      candidate_image_url: url,
      local_original_path: "",
      local_preview_path: "",
      mime_type: "",
      extension: "",
      width: null,
      height: null,
      file_size: null,
      sha256: "",
      match_status: match.match_status,
      tinda_sku: match.tinda_sku,
      download_status: "skipped",
      error_message: "",
      duplicate_of: "",
      review_status: "pending",
    };

    urls_processed += 1;
    if (!url) {
      row.download_status = "error";
      row.error_message = "empty_candidate_image_url";
      errors += 1;
      rows.push(row);
      continue;
    }

    try {
      const candidates_urls = image_url_fallbacks(url);
      let fetched: { url: string; buf: Buffer; status: number } | null = null;
      let last_err: Error | null = null;
      for (const try_url of candidates_urls) {
        try {
          const attempt = await fetch_image_buffer(try_url);
          assert_not_blocked(attempt.status, attempt.buf, try_url);
          fetched = attempt;
          break;
        } catch (e) {
          last_err = e instanceof Error ? e : new Error(String(e));
          // try next fallback; do not hard-stop on single 403
          if (
            last_err.message.startsWith("CAPTCHA") ||
            last_err.message.includes("CAPTCHA_or_HTML")
          ) {
            throw last_err;
          }
        }
      }
      if (!fetched) {
        throw last_err || new Error("download_failed");
      }
      const buf = fetched.buf;
      if (fetched.url !== url) {
        row.candidate_image_url = fetched.url;
      }

      if (buf.length > MAX_BYTES) {
        throw new Error(`file_too_large_${buf.length}`);
      }

      const format = detect_format(buf);
      if (!format) {
        throw new Error("not_jpeg_png_webp");
      }
      const ext = ext_of(format);
      if (!ALLOWED_EXT.has(ext) && !ALLOWED_EXT.has(format)) {
        throw new Error(`ext_forbidden_${ext}`);
      }

      // Reject SVG / script masquerading
      const head = buf.slice(0, 200).toString("utf8").toLowerCase();
      if (head.includes("<svg") || head.includes("<?xml")) {
        throw new Error("svg_or_xml_forbidden");
      }

      const meta = await sharp(buf, { failOn: "error" }).metadata();
      const width = meta.width ?? null;
      const height = meta.height ?? null;
      const hash = createHash("sha256").update(buf).digest("hex");

      row.mime_type = mime_of(format);
      row.extension = ext;
      row.width = width;
      row.height = height;
      row.file_size = buf.length;
      row.sha256 = hash;
      if ((width ?? 0) < 500 || (height ?? 0) < 500) below_500 += 1;

      const filename = `${base_name}.${ext}`;
      const abs_original = path.join(original_dir, filename);
      const abs_preview = path.join(
        preview_dir,
        `${base_name}.preview.webp`,
      );

      const first = sha_to_index.get(hash);
      if (first != null) {
        const primary = rows.find((r) => r.source_index === first)!;
        row.download_status = "duplicate";
        row.duplicate_of = String(first);
        row.local_original_path = primary.local_original_path;
        row.local_preview_path = primary.local_preview_path;
        duplicates += 1;
      } else {
        writeFileSync(abs_original, buf);
        const preview = await sharp(buf, { failOn: "error" })
          .rotate()
          .resize({
            width: 400,
            height: 400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 80 })
          .toBuffer();
        writeFileSync(abs_preview, preview);
        row.local_original_path = abs_original;
        row.local_preview_path = abs_preview;
        row.download_status = "ok";
        sha_to_index.set(hash, source_index);
        downloaded += 1;
        total_bytes += buf.length;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      row.download_status = "error";
      row.error_message = msg;
      errors += 1;
      if (msg.startsWith("CAPTCHA") || msg.includes("CAPTCHA_or_HTML")) {
        rows.push(row);
        // save progress and stop — site-wide block
        const manifest_path = path.join(out_root, "manifest.json");
        writeFileSync(
          manifest_path,
          JSON.stringify(
            {
              generated_at: new Date().toISOString(),
              stopped: true,
              stop_reason: msg,
              last_source_index: source_index,
              items: rows,
            },
            null,
            2,
          ),
        );
        console.error(`[zy-dl] STOPPED at index=${source_index}: ${msg}`);
        process.exit(2);
      }
    }

    rows.push(row);
    if (source_index % 10 === 0) {
      console.error(`[zy-dl] processed ${source_index}/${candidates.length}`);
    }
    await sleep(delay_ms);
  }

  const manifest_path = path.join(out_root, "manifest.json");
  const gallery_path = path.join(out_root, "gallery.html");
  const summary = {
    generated_at: new Date().toISOString(),
    candidates_file: candidates_path,
    candidates_count: candidates.length,
    urls_processed,
    downloaded_ok: downloaded,
    errors,
    duplicates_sha256: duplicates,
    below_500,
    total_original_bytes: total_bytes,
    original_dir,
    preview_dir,
    manifest_path,
    gallery_path,
    production_changed: false,
    images_uploaded: false,
    image_url_changed: false,
  };

  writeFileSync(
    manifest_path,
    JSON.stringify({ ...summary, items: rows }, null, 2),
  );
  writeFileSync(
    gallery_path,
    build_gallery_html(rows, "Зелёное яблоко — локальная галерея кандидатов"),
  );
  writeFileSync(
    path.join(out_root, "download-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
