#!/usr/bin/env node
/**
 * Draft review: «Зелёное яблоко» / Газированные напитки
 *
 * - Scrapes category listing pages (HTML product cards)
 * - Enriches via public product API (availability/image)
 * - Matches against TINDA catalog snapshot (read-only)
 * - Writes review Excel — NO production changes, NO VPS upload, NO image_url updates
 *
 * Usage:
 *   npx tsx scripts/zelenoe-yabloko/build-gazirovannye-review.ts \
 *     --products data/imports/tinda_active_products.snapshot.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { score_candidate_match } from "../../src/lib/catalog/external-images/match";
import { fetch_and_probe_image } from "../../src/lib/catalog/external-images/image-probe";
import { replacement_priority_for_product } from "../../src/lib/catalog/external-images/replacement-priority";
import type {
  ExternalImageCandidate,
  TindaProductImageTarget,
} from "../../src/lib/catalog/external-images/types";
import {
  build_zy_sku,
  dedupe_key,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const CATEGORY_URL =
  "https://zelenoeyabloko.ru/catalog/gazirovannye-napitki";
const USER_AGENT = "TINDA-catalog-research/1.0 (+https://tindagrupp.ru; draft-only)";
const SHOP_ID = 4;

type ZyRawCard = {
  id: string;
  source_product_url: string;
  source_name: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  can_buy: boolean | null;
  page: number;
};

type ZyProduct = ZyRawCard & {
  brand: string;
  flavor: string;
  volume_text: string | null;
  package_type: string | null;
  package_code: string;
  sugar_free: boolean | null;
  volume_ml: number | null;
  availability_reference: string;
  source_sku_ref: string | null;
  proposed_sku: string;
};

type ReviewStatus =
  | "exact_match"
  | "probable_match"
  | "new_product"
  | "conflict";

type ReviewRow = {
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  source_product_url: string;
  candidate_image_url: string;
  source_price_reference: string;
  tinda_product_id: string;
  tinda_sku: string;
  tinda_name: string;
  current_image_url: string;
  match_status: ReviewStatus;
  match_score: number;
  image_width: number | null;
  image_height: number | null;
  image_format: string;
  image_review_status: string;
  recommended_action: string;
  review_comment: string;
  proposed_sku?: string;
  sales_status?: string;
  price_amount?: string;
  price_currency?: string;
  is_active?: string;
  availability?: string;
};

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert_not_blocked(status: number, body: string, url: string) {
  const head = body.slice(0, 400).toLowerCase();
  if (status === 403 || status === 429 || status === 503) {
    throw new Error(`BLOCKED http_${status} at ${url}`);
  }
  if (
    head.includes("captcha") ||
    head.includes("cf-browser-verification") ||
    head.includes("smartcaptcha")
  ) {
    throw new Error(`CAPTCHA/block detected at ${url}`);
  }
}

async function fetch_text(url: string): Promise<{ status: number; text: string; final_url: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  });
  const text = await res.text();
  assert_not_blocked(res.status, text, url);
  return { status: res.status, text, final_url: res.url };
}

function parse_cards(html: string, page: number): ZyRawCard[] {
  const cards: ZyRawCard[] = [];
  const blocks = html.split(/<article class="product-card\s*"/).slice(1);
  for (const block of blocks) {
    const head = block.slice(0, 1200);
    const id = /data-product-id="(\d+)"/.exec(head)?.[1];
    if (!id) continue;
    const source_product_url =
      /data-product-url="([^"]+)"/.exec(head)?.[1] ||
      `https://zelenoeyabloko.ru/product/${id}`;
    const source_name = /data-product-name="([^"]*)"/.exec(head)?.[1] || "";
    const candidate_image_url =
      /data-product-image="([^"]*)"/.exec(head)?.[1] || "";
    const price_raw = /data-product-price="([^"]*)"/.exec(head)?.[1] || "";
    const can_buy_raw = /data-can-buy="([^"]*)"/.exec(head)?.[1];
    if (!source_name) continue;
    cards.push({
      id,
      source_product_url,
      source_name: source_name.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      candidate_image_url,
      source_price_reference: price_raw ? Number(price_raw) : null,
      can_buy: can_buy_raw == null ? null : can_buy_raw === "1",
      page,
    });
  }
  // Dedupe by id within page
  const by_id = new Map<string, ZyRawCard>();
  for (const c of cards) by_id.set(c.id, c);
  return [...by_id.values()];
}

async function scrape_category(delay_ms: number): Promise<{
  pages: number;
  cards: ZyRawCard[];
}> {
  const all: ZyRawCard[] = [];
  const seen_ids = new Set<string>();
  let pages = 0;
  let page = 1;
  let stagnant = 0;

  while (page <= 20) {
    const url =
      page === 1 ? CATEGORY_URL : `${CATEGORY_URL}?page=${page}&sort=popular`;
    console.error(`[zy] fetch page ${page}: ${url}`);
    const { status, text } = await fetch_text(url);
    if (status >= 400) {
      throw new Error(`Category page HTTP ${status}: ${url}`);
    }
    pages += 1;
    const cards = parse_cards(text, page);
    let new_count = 0;
    for (const c of cards) {
      if (seen_ids.has(c.id)) continue;
      seen_ids.add(c.id);
      all.push(c);
      new_count += 1;
    }
    console.error(`[zy] page ${page}: cards=${cards.length} new=${new_count}`);
    if (new_count === 0) {
      stagnant += 1;
      if (stagnant >= 1 || cards.length === 0) break;
    } else {
      stagnant = 0;
    }
    // Site currently serves the full category on one page; stop after confirming page 2 has no new IDs.
    if (page >= 2 && new_count === 0) break;
    page += 1;
    await sleep(delay_ms);
  }

  return { pages, cards: all };
}

async function enrich_product(
  card: ZyRawCard,
): Promise<{ remain_qty: number | null; image: string | null; articul: string | null }> {
  const url = `https://zelenoeyabloko.ru/api/store/products/${card.id}?shop_id=${SHOP_ID}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  assert_not_blocked(res.status, text, url);
  if (res.status >= 400) {
    return { remain_qty: null, image: null, articul: null };
  }
  const data = JSON.parse(text) as {
    image?: string;
    images?: string[];
    articul?: string;
    remain?: { quantity?: number };
    price?: { value?: number };
  };
  return {
    remain_qty:
      typeof data.remain?.quantity === "number" ? data.remain.quantity : null,
    image: data.image || data.images?.[0] || null,
    articul: data.articul || null,
  };
}

function availability_text(
  can_buy: boolean | null,
  remain_qty: number | null,
): string {
  if (remain_qty != null) {
    if (remain_qty <= 0) return `out_of_stock(remain=${remain_qty})`;
    return `in_stock(remain=${remain_qty})`;
  }
  if (can_buy === false) return "unavailable(can_buy=0)";
  if (can_buy === true) return "available(can_buy=1)";
  return "unknown";
}

function to_candidate(p: ZyProduct): ExternalImageCandidate {
  return {
    source_site: "zelenoeyabloko.ru",
    source_product_url: p.source_product_url,
    candidate_image_url: p.candidate_image_url,
    source_name: p.source_name,
    source_brand: p.brand,
    source_volume: p.volume_text,
    source_package: p.package_type,
    source_flavor: p.flavor,
    source_sku: null,
    source_priority: 3,
  };
}

function match_zy_to_tinda(
  product: ZyProduct,
  catalog: TindaProductImageTarget[],
): {
  status: ReviewStatus;
  score: number;
  tinda: TindaProductImageTarget | null;
  reasons: string[];
  rivals: TindaProductImageTarget[];
} {
  const candidate = to_candidate(product);
  const scored = catalog
    .map((t) => score_candidate_match(t, candidate))
    .filter((m) => m.match_status !== "no_match")
    .sort((a, b) => b.match_score - a.match_score);

  if (scored.length === 0) {
    return {
      status: "new_product",
      score: 0,
      tinda: null,
      reasons: ["no_tinda_match"],
      rivals: [],
    };
  }

  const top = scored[0]!;
  const close = scored.filter(
    (m) =>
      m.tinda.id !== top.tinda.id &&
      top.match_score - m.match_score <= 5 &&
      m.match_score >= 70,
  );
  if (close.length > 0 && top.match_score >= 70) {
    return {
      status: "conflict",
      score: top.match_score,
      tinda: top.tinda,
      reasons: [
        ...top.reasons,
        `ambiguous_with:${close.map((c) => c.tinda.sku).join(",")}`,
      ],
      rivals: close.map((c) => c.tinda),
    };
  }

  if (top.match_status === "exact_match") {
    return {
      status: "exact_match",
      score: top.match_score,
      tinda: top.tinda,
      reasons: top.reasons,
      rivals: [],
    };
  }
  return {
    status: "probable_match",
    score: top.match_score,
    tinda: top.tinda,
    reasons: top.reasons,
    rivals: [],
  };
}

function is_external_or_unstable(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u) return true;
  if (!/^https?:\/\//i.test(u)) return false;
  return !u.includes("/uploads/products/");
}

async function main() {
  if (process.argv.includes("--apply-production")) {
    throw new Error("Production apply is disabled for this draft script.");
  }

  const products_file = arg(
    "products",
    "data/imports/tinda_active_products.snapshot.json",
  )!;
  const out_xlsx = path.resolve(
    arg("out", "data/imports/zelenoe_yabloko_gazirovannye_review.xlsx")!,
  );
  const page_delay = Number(arg("page-delay-ms", "900"));
  const detail_delay = Number(arg("detail-delay-ms", "650"));
  const skip_probe = process.argv.includes("--skip-probe");
  const skip_detail = process.argv.includes("--skip-detail");

  const catalog = JSON.parse(
    readFileSync(path.resolve(products_file), "utf8"),
  ) as TindaProductImageTarget[];

  const { pages, cards } = await scrape_category(page_delay);
  console.error(`[zy] scraped pages=${pages} products=${cards.length}`);

  const enriched: ZyProduct[] = [];
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i]!;
    const parsed = parse_zy_product_name(card.source_name);
    let remain_qty: number | null = null;
    let articul: string | null = null;
    let image = card.candidate_image_url;

    if (!skip_detail) {
      try {
        const detail = await enrich_product(card);
        remain_qty = detail.remain_qty;
        articul = detail.articul;
        if (detail.image) image = detail.image;
      } catch (e) {
        if (String(e).includes("CAPTCHA") || String(e).includes("BLOCKED")) {
          throw e;
        }
        console.error(`[zy] detail failed for ${card.id}:`, e);
      }
      await sleep(detail_delay);
    }

    enriched.push({
      ...card,
      candidate_image_url: image,
      brand: parsed.brand,
      flavor: parsed.flavor,
      volume_text: parsed.volume_text,
      package_type: parsed.package_type,
      package_code: parsed.package_code,
      sugar_free: parsed.sugar_free,
      volume_ml: parsed.volume_ml,
      availability_reference: availability_text(card.can_buy, remain_qty),
      source_sku_ref: articul,
      proposed_sku: "", // filled after dedupe
    });
    if ((i + 1) % 10 === 0) {
      console.error(`[zy] enriched ${i + 1}/${cards.length}`);
    }
  }

  // Deduplicate exact source duplicates (keep first / better image)
  const deduped: ZyProduct[] = [];
  const seen_keys = new Map<string, ZyProduct>();
  for (const p of enriched) {
    const key = dedupe_key(p);
    const prev = seen_keys.get(key);
    if (!prev) {
      seen_keys.set(key, p);
      deduped.push(p);
      continue;
    }
    // Prefer card with image URL present
    if (!prev.candidate_image_url && p.candidate_image_url) {
      const idx = deduped.indexOf(prev);
      seen_keys.set(key, p);
      if (idx >= 0) deduped[idx] = p;
    }
  }

  // Assign temporary SKUs for new-product candidates after stable sort
  deduped.sort((a, b) =>
    `${a.brand}|${a.volume_ml}|${a.package_code}|${a.flavor}|${a.source_name}`.localeCompare(
      `${b.brand}|${b.volume_ml}|${b.package_code}|${b.flavor}|${b.source_name}`,
      "ru",
    ),
  );
  const seq_by_prefix = new Map<string, number>();
  for (const p of deduped) {
    const prefix = `ZY-${p.brand.slice(0, 1)}`; // placeholder; real below
    void prefix;
    const brand = p.brand;
    const base = `${brand}|${p.volume_ml}|${p.package_code}`;
    const seq = (seq_by_prefix.get(base) || 0) + 1;
    seq_by_prefix.set(base, seq);
    p.proposed_sku = build_zy_sku(brand, p.volume_ml, p.package_code, seq);
  }

  // Match each ZY product → TINDA
  const rows: ReviewRow[] = [];
  const stats = {
    pages,
    found: cards.length,
    unique: deduped.length,
    already_in_tinda: 0,
    new_products: 0,
    exact_match: 0,
    probable_match: 0,
    photo_replace_candidates: 0,
    conflict: 0,
    low_quality_images: 0,
  };

  // Also detect one TINDA product claimed by multiple exact ZY candidates
  const exact_by_tinda = new Map<string, ZyProduct[]>();

  type Matched = {
    product: ZyProduct;
    status: ReviewStatus;
    score: number;
    tinda: TindaProductImageTarget | null;
    reasons: string[];
  };
  const matched: Matched[] = [];

  for (const p of deduped) {
    const m = match_zy_to_tinda(p, catalog);
    matched.push({
      product: p,
      status: m.status,
      score: m.score,
      tinda: m.tinda,
      reasons: m.reasons,
    });
    if (m.status === "exact_match" && m.tinda) {
      const list = exact_by_tinda.get(m.tinda.id) || [];
      list.push(p);
      exact_by_tinda.set(m.tinda.id, list);
    }
  }

  for (const [tinda_id, list] of exact_by_tinda) {
    if (list.length <= 1) continue;
    for (const row of matched) {
      if (row.tinda?.id === tinda_id && row.status === "exact_match") {
        row.status = "conflict";
        row.reasons.push(
          `multiple_zy_exact_for_tinda:${list.map((x) => x.id).join(",")}`,
        );
      }
    }
  }

  for (const m of matched) {
    const p = m.product;
    let image_width: number | null = null;
    let image_height: number | null = null;
    let image_format = "";
    let image_review_status = "not_probed";
    let recommended_action = "manual_review";
    const comments = [...m.reasons];

    if (m.status === "exact_match") stats.exact_match += 1;
    else if (m.status === "probable_match") stats.probable_match += 1;
    else if (m.status === "conflict") stats.conflict += 1;
    else if (m.status === "new_product") stats.new_products += 1;

    if (m.status === "exact_match" || m.status === "probable_match") {
      stats.already_in_tinda += 1;
    }

    let photo_better = false;
    if (
      !skip_probe &&
      p.candidate_image_url &&
      (m.status === "exact_match" || m.status === "probable_match")
    ) {
      const probe = await fetch_and_probe_image(p.candidate_image_url);
      await sleep(400);
      image_width = probe.width;
      image_height = probe.height;
      image_format = probe.format || "";
      if (probe.low_quality) stats.low_quality_images += 1;
      if (probe.reasons.some((r) => r.startsWith("blocked_") || r.includes("captcha"))) {
        throw new Error(`Image probe blocked: ${probe.reasons.join(",")}`);
      }
      image_review_status = probe.ok
        ? probe.has_watermark === true
          ? "reject_watermark"
          : "ok"
        : `reject:${probe.reasons.join(",")}`;

      if (m.status === "exact_match" && m.tinda && probe.ok && probe.has_watermark !== true) {
        let current_ok: boolean | null = null;
        if (m.tinda.image_url) {
          const cur = await fetch_and_probe_image(m.tinda.image_url);
          await sleep(400);
          current_ok = cur.ok;
          if (cur.ok && cur.width && probe.width && probe.width > cur.width * 1.15) {
            photo_better = true;
            comments.push("candidate_higher_resolution");
          }
          if (cur.low_quality) {
            photo_better = true;
            comments.push("current_low_quality");
          }
        } else {
          photo_better = true;
          comments.push("tinda_no_photo");
        }
        if (is_external_or_unstable(m.tinda.image_url)) {
          photo_better = true;
          comments.push("current_external_cdn");
        }
        const repl = replacement_priority_for_product(m.tinda, {
          current_image_ok: current_ok,
          current_low_quality: false,
          candidate_source_priority: 3,
          candidate_ok: true,
        });
        comments.push(`replace_priority:${repl.reason}`);
        if (photo_better && repl.priority <= 5) {
          recommended_action = "replace_photo_after_manual_confirm";
          stats.photo_replace_candidates += 1;
          image_review_status = "candidate_better_or_needed";
        } else if (!photo_better) {
          recommended_action = "keep_current_image";
          image_review_status = "current_ok_keep";
        }
      }
    } else if (skip_probe) {
      image_review_status = "probe_skipped";
    }

    if (m.status === "new_product") {
      recommended_action = "prepare_showcase_draft_only";
      comments.push(
        "sales_status=showcase; price_amount=empty; availability=on_order; DO_NOT_IMPORT_YET",
      );
    } else if (m.status === "probable_match") {
      recommended_action = "manual_match_review";
    } else if (m.status === "conflict") {
      recommended_action = "resolve_conflict_manually";
    } else if (m.status === "exact_match" && recommended_action === "manual_review") {
      recommended_action = "exact_match_review_photo";
    }

    rows.push({
      source_name: p.source_name,
      brand: p.brand,
      flavor: p.flavor,
      volume_text: p.volume_text || "",
      package_type: p.package_type || "",
      source_product_url: p.source_product_url,
      candidate_image_url: p.candidate_image_url,
      source_price_reference:
        p.source_price_reference != null ? String(p.source_price_reference) : "",
      tinda_product_id: m.tinda?.id || "",
      tinda_sku: m.tinda?.sku || "",
      tinda_name: m.tinda?.name || "",
      current_image_url: m.tinda?.image_url || "",
      match_status: m.status,
      match_score: m.score,
      image_width,
      image_height,
      image_format,
      image_review_status,
      recommended_action,
      review_comment: [
        ...comments,
        `availability_reference=${p.availability_reference}`,
        p.source_sku_ref ? `zy_articul=${p.source_sku_ref}` : "",
        `proposed_sku=${p.proposed_sku}`,
      ]
        .filter(Boolean)
        .join("; "),
      proposed_sku: p.proposed_sku,
      sales_status: m.status === "new_product" ? "showcase" : "",
      price_amount: m.status === "new_product" ? "" : "",
      price_currency: m.status === "new_product" ? "RUB" : "",
      is_active: m.status === "new_product" ? "true" : "",
      availability: m.status === "new_product" ? "on_order" : "",
    });
  }

  const sheet_cols = (list: ReviewRow[]) =>
    list.map((r) => ({
      source_name: r.source_name,
      brand: r.brand,
      flavor: r.flavor,
      volume_text: r.volume_text,
      package_type: r.package_type,
      source_product_url: r.source_product_url,
      candidate_image_url: r.candidate_image_url,
      source_price_reference: r.source_price_reference,
      tinda_product_id: r.tinda_product_id,
      tinda_sku: r.tinda_sku,
      tinda_name: r.tinda_name,
      current_image_url: r.current_image_url,
      match_status: r.match_status,
      match_score: r.match_score,
      image_width: r.image_width,
      image_height: r.image_height,
      image_format: r.image_format,
      image_review_status: r.image_review_status,
      recommended_action: r.recommended_action,
      review_comment: r.review_comment,
      proposed_sku: r.proposed_sku || "",
      sales_status: r.sales_status || "",
      price_amount: r.price_amount || "",
      price_currency: r.price_currency || "",
      is_active: r.is_active || "",
      availability: r.availability || "",
    }));

  const news = rows.filter((r) => r.match_status === "new_product");
  const exact = rows.filter((r) => r.match_status === "exact_match");
  const photo = rows.filter(
    (r) => r.recommended_action === "replace_photo_after_manual_confirm",
  );
  const probable = rows.filter((r) => r.match_status === "probable_match");
  const conflicts = rows.filter((r) => r.match_status === "conflict");

  const instruction = [
    {
      step: 1,
      text: "Источник: https://zelenoeyabloko.ru/catalog/gazirovannye-napitki — только черновик.",
    },
    {
      step: 2,
      text: "source_price_reference — справочно, НЕ цена ТИНДА. Цены каталога не менять.",
    },
    {
      step: 3,
      text: "new_product: витрина (showcase, price пусто, on_order). Не импортировать без ручного подтверждения.",
    },
    {
      step: 4,
      text: "exact_match + replace_photo_after_manual_confirm: фото можно скачать локально после approve; на VPS не загружать автоматически.",
    },
    {
      step: 5,
      text: "Временный SKU: ZY-{BRAND}-{VOLUME_ML}-{PACKAGE}-{SEQ}. Только латиница/цифры/дефисы.",
    },
    {
      step: 6,
      text: "Production / БД / image_url этим отчётом не меняются.",
    },
  ];

  mkdirSync(path.dirname(out_xlsx), { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet_cols(news)), "Новые товары");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet_cols(exact)), "Точные совпадения");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet_cols(photo)), "Возможная замена фото");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet_cols(probable)), "Требует проверки");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet_cols(conflicts)), "Конфликты");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instruction), "Инструкция");
  XLSX.writeFile(wb, out_xlsx);

  const report = {
    generated_at: new Date().toISOString(),
    source: CATEGORY_URL,
    out_xlsx,
    stats,
    production_changed: false,
    images_uploaded: false,
    note: "Draft only. No TINDA DB/price/image_url changes.",
  };
  const report_path = out_xlsx.replace(/\.xlsx$/i, ".report.json");
  writeFileSync(report_path, JSON.stringify(report, null, 2));
  writeFileSync(
    path.resolve("data/imports/zelenoe_yabloko_gazirovannye_candidates.json"),
    JSON.stringify(
      deduped.map((p) => ({
        source_site: "zelenoeyabloko.ru",
        source_product_url: p.source_product_url,
        candidate_image_url: p.candidate_image_url,
        source_name: p.source_name,
        source_brand: p.brand,
        source_volume: p.volume_text,
        source_package: p.package_type,
        source_flavor: p.flavor,
        source_priority: 3,
        source_price_reference: p.source_price_reference,
        availability_reference: p.availability_reference,
        proposed_sku: p.proposed_sku,
      })),
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
