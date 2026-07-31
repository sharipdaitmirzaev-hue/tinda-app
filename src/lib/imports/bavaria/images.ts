import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { sku_slug } from "./sku";
import type { ProposedProduct } from "./types";

const UA = "TINDA-ImportBot/1.0 (+https://tindamarket.ru; catalog research)";

function ext_from_mime(mime: string, url: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  const m = url.toLowerCase().match(/\.(png|jpe?g|webp)(?:$|\?)/);
  return m ? m[1].replace("jpeg", "jpg") : "jpg";
}

export type ImageReportRow = {
  proposed_sku: string;
  source_image_url: string | null;
  local_image_path: string | null;
  sha256: string | null;
  bytes: number | null;
  status: "downloaded" | "reused" | "missing" | "skipped_alcohol" | "error";
  notes: string;
};

export async function download_images_for_proposed(
  proposed: ProposedProduct[],
  images_dir: string,
  options: { min_interval_ms?: number } = {},
): Promise<{ proposed: ProposedProduct[]; report: ImageReportRow[] }> {
  mkdirSync(images_dir, { recursive: true });
  const report: ImageReportRow[] = [];
  const hash_to_path = new Map<string, string>();
  const out = proposed.map((p) => ({ ...p }));
  let last = 0;
  const gap = options.min_interval_ms ?? 700;

  for (const item of out) {
    if (!item.image_url) {
      report.push({
        proposed_sku: item.proposed_sku,
        source_image_url: null,
        local_image_path: null,
        sha256: null,
        bytes: null,
        status: "missing",
        notes: "Нет image_url на карточке",
      });
      continue;
    }

    const wait = gap - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();

    try {
      const res = await fetch(item.image_url, {
        headers: { "User-Agent": UA, Referer: "https://www.bavaria-group.ru/" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = res.headers.get("content-type") || "";
      if (!mime.startsWith("image/") && !/\.(png|jpe?g|webp)(\?|$)/i.test(item.image_url)) {
        throw new Error(`Not an image MIME: ${mime}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error("Image too small");
      const sha = createHash("sha256").update(buf).digest("hex");
      const ext = ext_from_mime(mime, item.image_url);
      const file_base = [
        "bavaria",
        sku_slug(item.brand, 16).toLowerCase(),
        sku_slug(item.taste || item.official_name, 20).toLowerCase(),
        sku_slug(item.volume, 8).toLowerCase(),
        sku_slug(item.package, 8).toLowerCase(),
      ].join("-");

      if (hash_to_path.has(sha)) {
        item.local_image_path = hash_to_path.get(sha)!;
        report.push({
          proposed_sku: item.proposed_sku,
          source_image_url: item.image_url,
          local_image_path: item.local_image_path,
          sha256: sha,
          bytes: buf.length,
          status: "reused",
          notes: "Дубликат содержимого — переиспользован файл",
        });
        continue;
      }

      let file_name = `${file_base}.${ext}`;
      let full = path.join(images_dir, file_name);
      if (existsSync(full)) {
        const existing = readFileSync(full);
        const existing_sha = createHash("sha256").update(existing).digest("hex");
        if (existing_sha !== sha) {
          file_name = `${file_base}-${sha.slice(0, 8)}.${ext}`;
          full = path.join(images_dir, file_name);
        }
      }
      if (!existsSync(full)) writeFileSync(full, buf);
      hash_to_path.set(sha, full);
      item.local_image_path = full;
      report.push({
        proposed_sku: item.proposed_sku,
        source_image_url: item.image_url,
        local_image_path: full,
        sha256: sha,
        bytes: buf.length,
        status: existsSync(full) ? "downloaded" : "error",
        notes: "",
      });
    } catch (err) {
      report.push({
        proposed_sku: item.proposed_sku,
        source_image_url: item.image_url,
        local_image_path: null,
        sha256: null,
        bytes: null,
        status: "error",
        notes: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { proposed: out, report };
}
