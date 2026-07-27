#!/usr/bin/env node
/**
 * Scrape «Зелёное яблоко» / Газированные напитки → candidates JSON
 * for the external-images pipeline.
 *
 * Does NOT change production / VPS / DB / image_url.
 * Does NOT download approved images.
 * Stops on CAPTCHA / 403 / 429 and saves progress.
 *
 * Output: data/imports/zelenoe_yabloko_gazirovannye_candidates.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const CATEGORY_URL =
  "https://zelenoeyabloko.ru/catalog/gazirovannye-napitki";
const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; candidates-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT =
  "data/imports/zelenoe_yabloko_gazirovannye_candidates.json";

type ZyCard = {
  id: string;
  source_product_url: string;
  source_name: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  can_buy: boolean | null;
  page: number;
};

export type ZyCandidateRow = {
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
  // aliases for external-images pipeline
  source_brand: string;
  source_flavor: string;
  source_volume: string;
  source_package: string;
  source_priority: 3;
  source_product_id?: string;
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

function parse_cards(html: string, page: number): ZyCard[] {
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
    });
  }
  return [...by_id.values()];
}

function clean_flavor(raw: string): string {
  return raw
    .replace(/\b(напиток|газир(?:ованный)?|газ)\b/gi, " ")
    .replace(/\b(пл\s*\/\s*б|ст\s*\/\s*б|ж\s*\/\s*б|пэт|pet|банка|стекло)\b/gi, " ")
    .replace(/\b(пл|ст|ж)\s+б\b/gi, " ")
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)?/gi, " ")
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

function save_progress(
  out: string,
  payload: Record<string, unknown>,
) {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2));
  const progress = out.replace(/\.json$/i, ".progress.json");
  writeFileSync(progress, JSON.stringify(payload, null, 2));
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
  let last_page = 0;
  let page = 1;

  try {
    while (page <= 20) {
      const url =
        page === 1 ? CATEGORY_URL : `${CATEGORY_URL}?page=${page}&sort=popular`;
      console.error(`[zy-scrape] page ${page}: ${url}`);
      const { status, text } = await fetch_text(url);
      if (status >= 400) throw new Error(`HTTP ${status} at ${url}`);
      pages += 1;
      last_page = page;
      const page_cards = parse_cards(text, page);
      let neu = 0;
      for (const c of page_cards) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        cards.push(c);
        neu += 1;
      }
      console.error(`[zy-scrape] page ${page}: cards=${page_cards.length} new=${neu}`);
      if (neu === 0) break;
      page += 1;
      await sleep(page_delay);
    }

    const rows: ZyCandidateRow[] = [];
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
      });
      if ((i + 1) % 10 === 0) {
        console.error(`[zy-scrape] enriched ${i + 1}/${cards.length}`);
        save_progress(out, {
          partial: true,
          last_page,
          pages,
          found: cards.length,
          enriched: i + 1,
          candidates: rows,
        });
      }
    }

    // Dedupe exact source duplicates
    const unique: ZyCandidateRow[] = [];
    const keys = new Map<string, ZyCandidateRow>();
    for (const r of rows) {
      const key = dedupe_key({
        brand: r.brand,
        source_name: r.source_name,
        flavor: r.flavor,
        volume_text: r.volume_text,
        package_type: r.package_type,
        sugar_free: parse_zy_product_name(r.source_name).sugar_free,
      });
      if (keys.has(key)) continue;
      keys.set(key, r);
      unique.push(r);
    }

    const payload = unique;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(payload, null, 2));
    writeFileSync(
      out.replace(/\.json$/i, ".scrape-report.json"),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          source: CATEGORY_URL,
          pages,
          last_page,
          found: cards.length,
          unique: unique.length,
          out,
          production_changed: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          pages,
          last_page,
          found: cards.length,
          unique: unique.length,
          out,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const partial_path = out.replace(/\.json$/i, ".progress.json");
    console.error(`[zy-scrape] STOPPED: ${message}`);
    console.error(`[zy-scrape] last_page=${last_page} pages=${pages} cards=${cards.length}`);
    console.error(`[zy-scrape] progress file: ${partial_path}`);
    process.exit(2);
  }
}

main();
