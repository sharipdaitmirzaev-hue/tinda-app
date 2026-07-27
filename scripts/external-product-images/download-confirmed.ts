#!/usr/bin/env node
/**
 * Download approved external images LOCALLY only.
 *
 * Reads review xlsx where review_status=approved (or --status needs_review for dry staging).
 * Saves to: data/imports/external-product-images/{SKU}.original.{ext}
 *
 * Does NOT upload to VPS.
 * Does NOT update DB / image_url.
 *
 * Stops on CAPTCHA/blocking.
 */
import { createRequire } from "node:module";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ext_from(url: string, mime: string | null): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  const u = url.toLowerCase().split("?")[0] || "";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "jpg";
  if (u.endsWith(".png")) return "png";
  if (u.endsWith(".webp")) return "webp";
  return "bin";
}

async function main() {
  const review_path = path.resolve(
    arg("review", "data/imports/external_product_images_review.xlsx")!,
  );
  const out_dir = path.resolve(
    arg("out-dir", "data/imports/external-product-images")!,
  );
  const status_wanted = (arg("status", "approved") || "approved").toLowerCase();
  const delay_ms = Number(arg("delay-ms", "700"));
  const limit = Number(arg("limit", "0")) || 0;

  if (!existsSync(review_path)) {
    throw new Error(`Review file not found: ${review_path}`);
  }

  const wb = XLSX.readFile(review_path);
  const preferred = [
    "К одобрению",
    "Точные совпадения",
    "Требует проверки",
    "Конфликты",
  ];
  const sheets = [
    ...preferred.filter((n) => wb.Sheets[n]),
    ...wb.SheetNames.filter((n: string) => !preferred.includes(n) && n !== "Инструкция"),
  ];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const name of sheets) {
    if (!wb.Sheets[name]) continue;
    for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) as Record<
      string,
      unknown
    >[]) {
      const key = `${row.tinda_sku}||${row.candidate_image_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  const selected = rows.filter((r) => {
    const st = String(r.review_status || "").toLowerCase();
    if (st !== status_wanted) return false;
    if (String(r.match_status) === "conflict" && status_wanted === "approved") {
      return false; // never auto-download conflicts even if mis-labeled
    }
    return Boolean(String(r.candidate_image_url || "").trim());
  });

  const todo = limit > 0 ? selected.slice(0, limit) : selected;
  mkdirSync(out_dir, { recursive: true });

  const report = {
    started_at: new Date().toISOString(),
    review_path,
    out_dir,
    status_wanted,
    planned: todo.length,
    downloaded: [] as Array<Record<string, unknown>>,
    errors: [] as Array<Record<string, unknown>>,
    stopped: null as string | null,
  };

  for (const row of todo) {
    const sku = String(row.tinda_sku || "").trim();
    const url = String(row.candidate_image_url || "").trim();
    if (!sku || !url) continue;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "TINDA-external-image-download/1.0",
          Accept: "image/*,*/*;q=0.8",
        },
      });
      clearTimeout(timer);

      if (res.status === 403 || res.status === 429 || res.status === 503) {
        report.stopped = `blocked_http_${res.status} at ${url}`;
        report.errors.push({ sku, url, error: report.stopped });
        break;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const head = buf.slice(0, 200).toString("utf8").toLowerCase();
      if (head.includes("captcha") || head.includes("<html")) {
        report.stopped = `captcha_or_html at ${url}`;
        report.errors.push({ sku, url, error: report.stopped });
        break;
      }

      const mime = res.headers.get("content-type");
      const ext = ext_from(url, mime);
      if (ext === "bin") {
        report.errors.push({ sku, url, error: "unknown_image_type" });
        await sleep(delay_ms);
        continue;
      }

      const filename = `${sku}.original.${ext}`;
      const target = path.join(out_dir, filename);
      // sequential write
      await pipeline(Readable.from(buf), createWriteStream(target));
      report.downloaded.push({
        sku,
        url,
        file: target,
        bytes: buf.length,
        mime,
      });
    } catch (e) {
      report.errors.push({
        sku,
        url,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    await sleep(delay_ms);
  }

  report.started_at = report.started_at;
  const finished = {
    ...report,
    finished_at: new Date().toISOString(),
    downloaded_count: report.downloaded.length,
    error_count: report.errors.length,
  };
  const report_path = path.join(out_dir, "_download-report.json");
  writeFileSync(report_path, JSON.stringify(finished, null, 2));
  console.log(JSON.stringify(finished, null, 2));

  if (report.stopped) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
