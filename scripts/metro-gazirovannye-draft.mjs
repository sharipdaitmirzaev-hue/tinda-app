#!/usr/bin/env node
/**
 * Draft-only METRO catalog collector for ТИНДА.
 *
 * Does NOT write to the production database.
 * Source: https://online.metro-cc.ru/search?q=газированные%20напитки
 *
 * Usage:
 *   node scripts/metro-gazirovannye-draft.mjs
 *
 * Env (optional):
 *   METRO_DELAY_MS=2000          pause between page requests
 *   METRO_MAX_PAGES=0            0 = all pages
 *   METRO_STORE_ID=10            store cookie (default Moscow TC)
 *   METRO_OUT_DIR=data/imports   output directory
 */

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SEARCH_QUERY = "газированные напитки";
const BASE = "https://online.metro-cc.ru";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Keep only carbonated soft-drink categories from this search. */
const ALLOWED_CATEGORY_NAMES = new Set([
  "Газировка и лимонады",
  "Тоник",
]);

const ALLOWED_CATEGORY_SLUGS = new Set(["napitki-105003", "tonik"]);

const DELAY_MS = Number(process.env.METRO_DELAY_MS || 2000);
const MAX_PAGES = Number(process.env.METRO_MAX_PAGES || 0);
const STORE_ID = String(process.env.METRO_STORE_ID || "10");
const OUT_DIR = path.resolve(
  ROOT,
  process.env.METRO_OUT_DIR || "data/imports",
);

const EXCEL_COLUMNS = [
  "source_url",
  "source_name",
  "brand",
  "volume_text",
  "package_type",
  "units_per_package",
  "category_slug",
  "image_url",
  "metro_price",
  "sku",
  "tinda_name",
  "price_amount",
  "is_active",
  "import_status",
  "comment",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize_text(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize_key_part(value) {
  return normalize_text(value).toLowerCase().replace(/ё/g, "е");
}

function dedupe_key(brand, name, volume) {
  return [
    normalize_key_part(brand),
    normalize_key_part(name),
    normalize_key_part(volume),
  ].join("|");
}

function detect_block(html, status) {
  const lower = html.toLowerCase();
  const markers = [
    "smartcaptcha",
    "captcha-container",
    "are you a robot",
    "доступ ограничен",
    "request blocked",
    "cf-challenge",
    "attention required",
  ];
  if (status === 403 || status === 429) {
    return `HTTP ${status}`;
  }
  if (!html.includes("window.__NUXT__") && markers.some((m) => lower.includes(m))) {
    return "CAPTCHA/block page without NUXT payload";
  }
  if (html.length < 5000 && markers.some((m) => lower.includes(m))) {
    return "Likely CAPTCHA/block (small HTML)";
  }
  if (!html.includes("window.__NUXT__")) {
    return "Missing window.__NUXT__ payload";
  }
  return null;
}

async function fetch_text(url, cookie_jar) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    Referer: `${BASE}/`,
    Cookie: cookie_jar.toHeader(),
  };
  const response = await fetch(url, {
    headers,
    redirect: "follow",
  });
  const set_cookies = response.headers.getSetCookie?.() || [];
  for (const raw of set_cookies) {
    cookie_jar.add(raw);
  }
  // Fallback for runtimes without getSetCookie
  const single = response.headers.get("set-cookie");
  if (single && set_cookies.length === 0) {
    cookie_jar.add(single);
  }
  const text = await response.text();
  return { status: response.status, text, url: response.url };
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  add(raw) {
    const first = String(raw).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) return;
    this.map.set(name, value);
  }
  set(name, value) {
    this.map.set(name, String(value));
  }
  toHeader() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function extract_nuxt(html) {
  const marker = "window.__NUXT__=";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  // Payload ends at `;</script>` after the IIFE call.
  const end = html.indexOf("</script>", i);
  if (end < 0) return null;
  let expr = html.slice(i, end).trim();
  if (expr.endsWith(";")) expr = expr.slice(0, -1);
  // Evaluate in a constrained Function scope (METRO public SSR payload).
  // eslint-disable-next-line no-new-func
  return new Function(`return (${expr});`)();
}

function find_products_data(nuxt) {
  const fetch_bag = nuxt?.fetch;
  if (!fetch_bag || typeof fetch_bag !== "object") return null;
  for (const value of Object.values(fetch_bag)) {
    if (value && typeof value === "object" && value.productsData) {
      return value.productsData;
    }
  }
  return null;
}

function parse_volume(name) {
  const text = normalize_text(name);
  // Prefer volume before "x N шт" multipack marker.
  // Do not use \b after Cyrillic units — JS word boundaries are ASCII-only.
  const multipack = text.match(
    /(\d+(?:[.,]\d+)?)\s*(мл|л|ml|l)\s*[xх×]\s*\d+\s*шт/i,
  );
  if (multipack) {
    return normalize_volume(multipack[1], multipack[2]);
  }
  const plain = text.match(
    /(\d+(?:[.,]\d+)?)\s*(мл|л|ml|l)(?![а-яёa-z])/i,
  );
  if (plain) {
    return normalize_volume(plain[1], plain[2]);
  }
  return "";
}

function normalize_volume(amount_raw, unit_raw) {
  const amount = amount_raw.replace(",", ".");
  let unit = unit_raw.toLowerCase();
  if (unit === "l") unit = "л";
  if (unit === "ml") unit = "мл";
  return `${amount}${unit}`;
}

function parse_units_per_package(name, packing) {
  const text = normalize_text(name);
  const m = text.match(/[xх×]\s*(\d+)\s*шт/i);
  if (m) return Number(m[1]);
  const pack_size = Number(packing?.size);
  if (Number.isFinite(pack_size) && pack_size > 1) return pack_size;
  // Single bottle/can on listing — 1 unit when packing type is шт.
  if ((packing?.type || "").toLowerCase() === "шт") return 1;
  return "";
}

function parse_package_type(name, packing, slug) {
  const hay = `${normalize_text(name)} ${normalize_text(slug)}`.toLowerCase();
  if (
    /\b(жб|ж\/б|alumin|алюмин|can)\b/.test(hay) ||
    hay.includes("жб") ||
    hay.includes("zhb") ||
    hay.includes("-can")
  ) {
    return "жестяная банка";
  }
  if (
    hay.includes("стекл") ||
    hay.includes("st-") ||
    hay.includes("steklo") ||
    /\bsteklo\b/.test(hay)
  ) {
    return "стекло";
  }
  if (
    /\bpet\b/.test(hay) ||
    hay.includes("пэт") ||
    hay.includes("пластик") ||
    hay.includes("-pet")
  ) {
    return "PET";
  }
  if ((packing?.type || "").toLowerCase() === "уп") {
    return "упаковка";
  }
  if ((packing?.type || "").toLowerCase() === "шт") {
    return "шт";
  }
  return "";
}

function slugify_category(name) {
  const map = {
    "Газировка и лимонады": "gazirovka-i-limonady",
    Тоник: "tonik",
  };
  if (map[name]) return map[name];
  return normalize_text(name)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function pick_metro_price(product) {
  const stock = Array.isArray(product.stocks) ? product.stocks[0] : null;
  const prices = stock?.prices || stock?.prices_per_unit || null;
  const price = prices?.price;
  if (price === null || price === undefined || price === "") return "";
  const num = Number(price);
  return Number.isFinite(num) ? num : "";
}

function pick_availability(product) {
  const stock = Array.isArray(product.stocks) ? product.stocks[0] : null;
  if (!stock) return "";
  if (stock.eshop_availability === true) {
    return stock.text || "В наличии";
  }
  if (stock.eshop_availability === false) {
    return stock.text || "Нет в наличии";
  }
  return stock.text || "";
}

function is_allowed_category(product, slug_by_name) {
  const name = normalize_text(product?.category?.name);
  if (ALLOWED_CATEGORY_NAMES.has(name)) return true;
  const slug = slug_by_name.get(name);
  if (slug && ALLOWED_CATEGORY_SLUGS.has(slug)) return true;
  return false;
}

function map_product(product, slug_by_name, index) {
  const source_name = normalize_text(product.name);
  const brand = normalize_text(product?.manufacturer?.name);
  const volume_text = parse_volume(source_name);
  const package_type = parse_package_type(
    source_name,
    product.packing,
    product.slug,
  );
  const units_per_package = parse_units_per_package(
    source_name,
    product.packing,
  );
  const category_name = normalize_text(product?.category?.name);
  const category_slug =
    slug_by_name.get(category_name) || slugify_category(category_name);
  const image_url = Array.isArray(product.images) && product.images[0]
    ? String(product.images[0])
    : "";
  const source_path = product.url || (product.slug ? `/products/${product.slug}` : "");
  const source_url = source_path.startsWith("http")
    ? source_path
    : `${BASE}${source_path}`;

  const missing = [];
  if (!brand) missing.push("brand");
  if (!volume_text) missing.push("volume_text");
  if (!package_type) missing.push("package_type");
  if (units_per_package === "") missing.push("units_per_package");
  if (!category_slug) missing.push("category_slug");
  if (!image_url) missing.push("image_url");
  const metro_price = pick_metro_price(product);
  if (metro_price === "") missing.push("metro_price");
  const availability = pick_availability(product);
  if (!availability) missing.push("availability");

  const comment_parts = [];
  if (availability) comment_parts.push(`наличие: ${availability}`);
  if (missing.length) {
    comment_parts.push(`не определено: ${missing.join(", ")}`);
  }
  comment_parts.push(
    "metro_price справочное; не использовать как price_amount ТИНДА",
  );

  const sku = `METRO-${String(index).padStart(4, "0")}`;

  return {
    source_url,
    source_name,
    brand,
    volume_text,
    package_type,
    units_per_package,
    category_slug,
    image_url,
    metro_price,
    sku,
    tinda_name: source_name,
    price_amount: "",
    is_active: false,
    import_status: "draft",
    comment: comment_parts.join("; "),
    _missing: missing,
    _dedupe: dedupe_key(brand, source_name, volume_text),
    _category_name: category_name,
  };
}

function search_url(page) {
  const q = encodeURIComponent(SEARCH_QUERY);
  if (page <= 1) return `${BASE}/search?q=${q}`;
  return `${BASE}/search?q=${q}&page=${page}`;
}

async function collect_all_pages() {
  const jar = new CookieJar();
  jar.set("metroStoreId", STORE_ID);
  jar.set("is18Confirmed", "true");
  jar.set("metro_captcha", "1");

  // Warm-up to receive store/session cookies.
  const warm = await fetch_text(BASE + "/", jar);
  if (detect_block(warm.text, warm.status)) {
    throw new Error(`Blocked on warm-up: ${detect_block(warm.text, warm.status)}`);
  }
  await sleep(DELAY_MS);

  const raw_products = [];
  const rejected = [];
  let total = null;
  let page_size = 30;
  let pages_fetched = 0;
  let page = 1;
  const seen_slugs = new Set();

  while (true) {
    if (MAX_PAGES > 0 && page > MAX_PAGES) break;

    const url = search_url(page);
    console.log(`[page ${page}] GET ${url}`);
    const { status, text } = await fetch_text(url, jar);
    const block = detect_block(text, status);
    if (block) {
      throw new Error(`Stopped on page ${page}: ${block}`);
    }

    const nuxt = extract_nuxt(text);
    if (!nuxt) {
      throw new Error(`Failed to parse __NUXT__ on page ${page}`);
    }
    const products_data = find_products_data(nuxt);
    if (!products_data) {
      throw new Error(`productsData not found on page ${page}`);
    }

    if (total === null) {
      total = Number(products_data.total) || 0;
      console.log(`Search total reported by METRO: ${total}`);
    }

    const slug_by_name = new Map();
    for (const node of products_data.categoriesTree || []) {
      if (node?.name && node?.slug) {
        slug_by_name.set(normalize_text(node.name), String(node.slug));
      }
    }

    const page_products = Array.isArray(products_data.products)
      ? products_data.products
      : [];
    if (page === 1 && page_products.length > 0) {
      page_size = page_products.length;
    }
    pages_fetched += 1;

    let new_on_page = 0;
    for (const product of page_products) {
      // Skip non-product noise if any.
      if (!product?.name || !product?.slug) {
        rejected.push({ reason: "missing name/slug", product });
        continue;
      }
      if (seen_slugs.has(product.slug)) {
        continue;
      }
      seen_slugs.add(product.slug);
      new_on_page += 1;
      if (!is_allowed_category(product, slug_by_name)) {
        rejected.push({
          reason: `other category: ${product?.category?.name || "?"}`,
          slug: product.slug,
        });
        continue;
      }
      raw_products.push({ product, slug_by_name });
    }

    console.log(
      `[page ${page}] products=${page_products.length}, new=${new_on_page}, kept_so_far=${raw_products.length}, rejected_so_far=${rejected.length}`,
    );

    const expected_pages = total > 0 ? Math.ceil(total / page_size) : page;
    if (page_products.length === 0) break;
    if (page >= expected_pages) break;
    // Safety: if a page adds nothing new, stop to avoid infinite loops.
    if (new_on_page === 0) break;

    page += 1;
    await sleep(DELAY_MS);
  }

  return { raw_products, rejected, total, pages_fetched };
}

function dedupe_rows(mapped) {
  const seen = new Map();
  const unique = [];
  let duplicates = 0;
  for (const row of mapped) {
    if (seen.has(row._dedupe)) {
      duplicates += 1;
      continue;
    }
    seen.set(row._dedupe, true);
    unique.push(row);
  }
  return { unique, duplicates };
}

function assign_skus(rows) {
  return rows.map((row, idx) => ({
    ...row,
    sku: `METRO-${String(idx + 1).padStart(4, "0")}`,
  }));
}

function to_excel_rows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const col of EXCEL_COLUMNS) {
      out[col] = row[col] ?? "";
    }
    return out;
  });
}

function summarize_missing(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const field of row._missing || []) {
      counts.set(field, (counts.get(field) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function write_outputs(rows, meta) {
  await mkdir(OUT_DIR, { recursive: true });

  const excel_path = path.join(OUT_DIR, "metro_gazirovannye_napitki.xlsx");
  const json_path = path.join(OUT_DIR, "metro_gazirovannye_napitki.json");
  const report_path = path.join(OUT_DIR, "metro_gazirovannye_napitki.report.json");
  const images_cmd_path = path.join(
    OUT_DIR,
    "metro_gazirovannye_napitki.download-images.sh",
  );

  const sheet_rows = to_excel_rows(rows);
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(sheet_rows, { header: EXCEL_COLUMNS });
  XLSX.utils.book_append_sheet(book, sheet, "draft");
  XLSX.writeFile(book, excel_path);

  await writeFile(json_path, JSON.stringify(rows.map((r) => {
    const { _missing, _dedupe, _category_name, ...rest } = r;
    return { ...rest, missing_fields: _missing, category_name: _category_name };
  }), null, 2), "utf8");

  await writeFile(report_path, JSON.stringify(meta, null, 2), "utf8");

  const rel_json = path.relative(ROOT, json_path).replaceAll("\\", "/");
  const cmd = [
    "#!/usr/bin/env bash",
    "# Later image download for METRO draft rows. Does NOT upload to TINDA.",
    "# Usage: bash data/imports/metro_gazirovannye_napitki.download-images.sh [out-dir]",
    "set -euo pipefail",
    'ROOT="$(cd "$(dirname "$0")/../.." && pwd)"',
    `JSON="$ROOT/${rel_json}"`,
    'OUT_DIR="${1:-$ROOT/data/imports/metro-images}"',
    'mkdir -p "$OUT_DIR"',
    'node "$ROOT/scripts/metro-download-images-later.mjs" "$JSON" "$OUT_DIR"',
    "",
  ].join("\n");
  await writeFile(images_cmd_path, cmd, "utf8");

  return { excel_path, json_path, report_path, images_cmd_path };
}

async function main() {
  console.log("METRO draft import — no production DB writes");
  console.log(`Query: ${SEARCH_QUERY}`);
  console.log(`Delay between requests: ${DELAY_MS} ms`);

  const { raw_products, rejected, total, pages_fetched } =
    await collect_all_pages();

  const mapped = raw_products.map(({ product, slug_by_name }, idx) =>
    map_product(product, slug_by_name, idx + 1),
  );
  const found_count = mapped.length;
  const { unique, duplicates } = dedupe_rows(mapped);
  const with_sku = assign_skus(unique);
  const without_image = with_sku.filter((r) => !r.image_url).length;
  const missing_summary = summarize_missing(with_sku);
  const weak_package_type = with_sku.filter((r) =>
    r.package_type === "шт" || r.package_type === "упаковка",
  ).length;

  const meta = {
    source: search_url(1),
    generated_at: new Date().toISOString(),
    pages_fetched,
    metro_search_total: total,
    found_in_allowed_categories: found_count,
    unique_after_dedupe: with_sku.length,
    duplicates_removed: duplicates,
    rejected_other_category_or_noise: rejected.length,
    without_image,
    missing_fields: Object.fromEntries(missing_summary),
    partially_determined: {
      package_type_material_unknown: weak_package_type,
      note: "package_type=шт|упаковка means material (PET/стекло/жб) was not inferred from name/slug",
    },
    notes: [
      "metro_price is reference-only and must not become TINDA price_amount",
      "price_amount left empty intentionally",
      "images were not downloaded; only image_url links saved",
      "allowed categories: Газировка и лимонады, Тоник",
    ],
    rejected_sample: rejected.slice(0, 20),
  };

  const paths = await write_outputs(with_sku, meta);

  console.log("\n=== RESULT ===");
  console.log(`pages: ${pages_fetched}`);
  console.log(`found (allowed categories): ${found_count}`);
  console.log(`unique: ${with_sku.length}`);
  console.log(`without image: ${without_image}`);
  console.log(`excel: ${paths.excel_path}`);
  console.log(`json: ${paths.json_path}`);
  console.log(`report: ${paths.report_path}`);
  console.log(`later image download cmd: ${paths.images_cmd_path}`);
  console.log("missing fields:");
  if (missing_summary.length === 0) {
    console.log("  (none)");
  } else {
    for (const [field, count] of missing_summary) {
      console.log(`  ${field}: ${count}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
