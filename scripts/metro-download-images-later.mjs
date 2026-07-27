#!/usr/bin/env node
/**
 * Later-stage helper: download images from draft JSON image_url fields.
 * Does not upload to TINDA storage. Sequential with delay.
 *
 * Usage:
 *   node scripts/metro-download-images-later.mjs data/imports/metro_gazirovannye_napitki.json data/imports/metro-images
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const json_path = process.argv[2];
const out_dir = process.argv[3] || "data/imports/metro-images";
const delay_ms = Number(process.env.METRO_IMAGE_DELAY_MS || 1500);

if (!json_path) {
  console.error("Usage: node scripts/metro-download-images-later.mjs <json> [out-dir]");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extension_for(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return ".png";
  if (lower.includes(".webp")) return ".webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return ".jpg";
  return ".img";
}

const rows = JSON.parse(await readFile(json_path, "utf8"));
await mkdir(out_dir, { recursive: true });

let ok = 0;
let skipped = 0;
for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  const url = String(row.image_url || "").trim();
  const sku = String(row.sku || `row-${i + 1}`);
  if (!url) {
    skipped += 1;
    console.log(`[${i + 1}/${rows.length}] skip ${sku}: no image_url`);
    continue;
  }
  const dest = path.join(out_dir, `${sku}${extension_for(url)}`);
  console.log(`[${i + 1}/${rows.length}] ${sku} <- ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TINDA-draft-image-fetch/1.0; +https://tindagrupp.ru)",
      Accept: "image/*,*/*;q=0.8",
      Referer: "https://online.metro-cc.ru/",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buf);
  ok += 1;
  await sleep(delay_ms);
}

console.log(`done: downloaded=${ok}, skipped=${skipped}, out=${path.resolve(out_dir)}`);
