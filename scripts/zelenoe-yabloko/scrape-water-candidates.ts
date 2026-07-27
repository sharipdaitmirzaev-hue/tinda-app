#!/usr/bin/env node
/**
 * Scrape «Зелёное яблоко» water categories → candidates JSON.
 *
 * Categories:
 *   - https://zelenoeyabloko.ru/catalog/voda-gazirovannaia
 *   - https://zelenoeyabloko.ru/catalog/voda-negazirovannaia
 *
 * Mineral water has no separate catalog slug on the site; mineral SKUs
 * live inside the sparkling/still water sections.
 *
 * Does NOT change production / VPS / DB / image_url.
 *
 * Output: data/imports/zelenoe-yabloko-water/candidates.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  detect_carbonation,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const CATEGORIES = [
  {
    slug: "voda-gazirovannaia",
    url: "https://zelenoeyabloko.ru/catalog/voda-gazirovannaia",
    title: "Вода газированная",
    carbonation: "sparkling" as const,
  },
  {
    slug: "voda-negazirovannaia",
    url: "https://zelenoeyabloko.ru/catalog/voda-negazirovannaia",
    title: "Вода негазированная",
    carbonation: "still" as const,
  },
];

const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; water-candidates-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT = "data/imports/zelenoe-yabloko-water/candidates.json";

type ZyCard = {
  id: string;
  source_product_url: string;
  source_name: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  can_buy: boolean | null;
  page: number;
  category_slug: string;
  category_url: string;
  category_title: string;
  carbonation: "sparkling" | "still";
};

export type ZyWaterCandidateRow = {
  source_site: "zelenoeyabloko.ru";
  source_product_url: string;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  availability_reference: string;
  source_brand: string;
  source_flavor: string;
  source_volume: string;
  source_package: string;
  source_priority: 3;
  source_product_id?: string;
  source_category_slug: string;
  source_category_url: string;
  source_category_title: string;
  carbonation: "sparkling" | "still" | "unknown";
  is_mineral_hint: boolean;
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
  const head = body.slice(0, 500).toLowerCase();
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

async function fetch_text(url: string) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
  const text = await res.text();
  assert_not_blocked(res.status, text, url);
  return { status: res.status, text };
}

function parse_cards(
  html: string,
  page: number,
  cat: (typeof CATEGORIES)[number],
): ZyCard[] {
  const blocks = html.split(/<article class="product-card\s*"/).slice(1);
  const by_id = new Map<string, ZyCard>();
  for (const block of blocks) {
    const head = block.slice(0, 1200);
    const id = /data-product-id="(\d+)"/.exec(head)?.[1];
    if (!id) continue;
    const source_product_url =
      /data-product-url="([^"]+)"/.exec(head)?.[1] ||
      `https://zelenoeyabloko.ru/product/${id}`;
    const source_name = (/data-product-name="([^"]*)"/.exec(head)?.[1] || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    const candidate_image_url =
      /data-product-image="([^"]*)"/.exec(head)?.[1] || "";
    const price_raw = /data-product-price="([^"]*)"/.exec(head)?.[1] || "";
    const can_buy_raw = /data-can-buy="([^"]*)"/.exec(head)?.[1];
    if (!source_name) continue;
    by_id.set(id, {
      id,
      source_product_url,
      source_name,
      candidate_image_url,
      source_price_reference: price_raw ? Number(price_raw) : null,
      can_buy: can_buy_raw == null ? null : can_buy_raw === "1",
      page,
      category_slug: cat.slug,
      category_url: cat.url,
      category_title: cat.title,
      carbonation: cat.carbonation,
    });
  }
  return [...by_id.values()];
}

function clean_flavor(raw: string): string {
  return raw
    .replace(/\b(вода|питьевая|минеральная|лечебно[-\s]?столовая)\b/gi, " ")
    .replace(/\b(напиток|газир(?:ованный)?|негазир(?:ованная)?|газ|негаз)\b/gi, " ")
    .replace(/\b(пл\s*\/\s*б|ст\s*\/\s*б|ж\s*\/\s*б|пэт|pet|банка|стекло)\b/gi, " ")
    .replace(/\b(пл|ст|ж)\s+б\b/gi, " ")
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml|г)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function mineral_hint(name: string): boolean {
  return /(мин|mineral|боржом|нарзан|ессентук|архыз|набеглав|лечебно|столовая)/i.test(
    name,
  );
}

function save_progress(out: string, payload: Record<string, unknown>) {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2));
  writeFileSync(
    out.replace(/\.json$/i, ".progress.json"),
    JSON.stringify(payload, null, 2),
  );
}

async function enrich(card: ZyCard) {
  const url = `https://zelenoeyabloko.ru/api/store/products/${card.id}?shop_id=${SHOP_ID}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  const text = await res.text();
  assert_not_blocked(res.status, text, url);
  if (res.status >= 400) {
    return { remain_qty: null as number | null, image: null as string | null };
  }
  const data = JSON.parse(text) as {
    image?: string;
    images?: string[];
    remain?: { quantity?: number };
  };
  return {
    remain_qty:
      typeof data.remain?.quantity === "number" ? data.remain.quantity : null,
    image: data.image || data.images?.[0] || null,
  };
}

async function main() {
  const out = path.resolve(arg("out", DEFAULT_OUT)!);
  const page_delay = Number(arg("page-delay-ms", "900"));
  const detail_delay = Number(arg("detail-delay-ms", "650"));
  const skip_detail = process.argv.includes("--skip-detail");

  const cards: ZyCard[] = [];
  const seen = new Set<string>();
  let pages = 0;
  const pages_by_category: Record<string, number> = {};

  try {
    for (const cat of CATEGORIES) {
      pages_by_category[cat.slug] = 0;
      let page = 1;
      while (page <= 20) {
        const url =
          page === 1 ? cat.url : `${cat.url}?page=${page}&sort=popular`;
        console.error(`[zy-water] ${cat.slug} page ${page}: ${url}`);
        const { status, text } = await fetch_text(url);
        if (status >= 400) throw new Error(`HTTP ${status} at ${url}`);
        pages += 1;
        pages_by_category[cat.slug] += 1;
        const page_cards = parse_cards(text, page, cat);
        let neu = 0;
        for (const c of page_cards) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          cards.push(c);
          neu += 1;
        }
        console.error(
          `[zy-water] ${cat.slug} page ${page}: cards=${page_cards.length} new=${neu}`,
        );
        if (neu === 0) break;
        page += 1;
        await sleep(page_delay);
      }
    }

    const rows: ZyWaterCandidateRow[] = [];
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i]!;
      let image = card.candidate_image_url;
      let remain: number | null = null;
      if (!skip_detail) {
        const detail = await enrich(card);
        remain = detail.remain_qty;
        if (detail.image) image = detail.image;
        await sleep(detail_delay);
      }
      const parsed = parse_zy_product_name(card.source_name);
      const flavor = clean_flavor(parsed.flavor);
      const brand = parsed.brand;
      const volume_text = parsed.volume_text || "";
      const package_type = parsed.package_type || "";
      const carbonation =
        card.carbonation ||
        detect_carbonation(card.source_name, card.category_slug);

      rows.push({
        source_site: "zelenoeyabloko.ru",
        source_product_url: card.source_product_url,
        source_name: card.source_name,
        brand,
        flavor,
        volume_text,
        package_type,
        candidate_image_url: image,
        source_price_reference: card.source_price_reference,
        availability_reference: availability_text(card.can_buy, remain),
        source_brand: brand,
        source_flavor: flavor,
        source_volume: volume_text,
        source_package: package_type,
        source_priority: 3,
        source_product_id: card.id,
        source_category_slug: card.category_slug,
        source_category_url: card.category_url,
        source_category_title: card.category_title,
        carbonation,
        is_mineral_hint: mineral_hint(card.source_name),
      });
      if ((i + 1) % 10 === 0) {
        console.error(`[zy-water] enriched ${i + 1}/${cards.length}`);
        save_progress(out, {
          partial: true,
          pages,
          pages_by_category,
          found: cards.length,
          enriched: i + 1,
          candidates: rows,
        });
      }
    }

    const unique: ZyWaterCandidateRow[] = [];
    const keys = new Map<string, ZyWaterCandidateRow>();
    let internal_dupes = 0;
    for (const r of rows) {
      const key = dedupe_key({
        brand: r.brand,
        source_name: r.source_name,
        flavor: r.flavor,
        volume_text: r.volume_text,
        package_type: r.package_type,
        sugar_free: null,
      }) + `|${r.carbonation}`;
      if (keys.has(key)) {
        internal_dupes += 1;
        continue;
      }
      keys.set(key, r);
      unique.push(r);
    }

    const payload = {
      generated_at: new Date().toISOString(),
      note: "LOCAL DRAFT ONLY. Do not create products / change image_url / upload to VPS.",
      categories: CATEGORIES,
      pages_processed: pages,
      pages_by_category,
      found: cards.length,
      unique: unique.length,
      internal_duplicates_skipped: internal_dupes,
      mineral_hint_count: unique.filter((r) => r.is_mineral_hint).length,
      by_carbonation: {
        sparkling: unique.filter((r) => r.carbonation === "sparkling").length,
        still: unique.filter((r) => r.carbonation === "still").length,
        unknown: unique.filter((r) => r.carbonation === "unknown").length,
      },
      candidates: unique,
    };
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
    // flat array alias for pipeline tools that expect an array
    writeFileSync(
      out.replace(/candidates\.json$/i, "candidates.flat.json"),
      JSON.stringify(unique, null, 2) + "\n",
    );
    console.error(
      `[zy-water] done pages=${pages} found=${cards.length} unique=${unique.length} -> ${out}`,
    );
  } catch (err) {
    console.error("[zy-water] STOPPED:", err);
    process.exitCode = 1;
  }
}

main();
