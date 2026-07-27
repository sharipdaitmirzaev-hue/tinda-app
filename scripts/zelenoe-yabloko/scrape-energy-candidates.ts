#!/usr/bin/env node
/**
 * Scrape «Зелёное яблоко» energy drinks category → candidates JSON.
 *
 * Category:
 *   https://zelenoeyabloko.ru/catalog/energeticeskie-napitki
 *
 * Does NOT change production / VPS / DB / image_url.
 *
 * Output: data/imports/zelenoe-yabloko-energy/candidates.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const CATEGORY = {
  slug: "energeticeskie-napitki",
  url: "https://zelenoeyabloko.ru/catalog/energeticeskie-napitki",
  title: "Энергетические напитки",
};

const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; energy-candidates-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT = "data/imports/zelenoe-yabloko-energy/candidates.json";
const MAX_PAGES = 40;

type ZyCard = {
  id: string;
  source_product_url: string;
  source_name: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  can_buy: boolean | null;
  page: number;
};

export type ZyEnergyCandidateRow = {
  source_site: "zelenoeyabloko.ru";
  source_product_url: string;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  sugar_free: boolean | null;
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
  volume_ml: number | null;
  package_code: string;
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

function clean_flavor(raw: string, brand: string): string {
  let t = String(raw || "");
  if (brand) {
    const brand_re = new RegExp(
      brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "ig",
    );
    t = t.replace(brand_re, " ");
  }
  return t
    .replace(/напиток|энергетическ(?:ий|ие|ая)?|energy\s*drink|energy/gi, " ")
    .replace(/burn|берн/gi, " ")
    .replace(/пл\s*\/\s*б|ст\s*\/\s*б|ж\s*\/\s*б|пэт|pet|банка|стекло/gi, " ")
    .replace(/(?:^|\s)(?:пл|ст|ж)\s+б(?:\s|$)/gi, " ")
    .replace(/зеро|zero|sugar[\s-]?free|без\s*сахара/gi, " ")
    .replace(/\d+[.,]?\d*\s*(?:л|мл|l|ml|г)?/gi, " ")
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
  const scrape_errors: string[] = [];

  try {
    // Prefer store API by category_id (authoritative total), then HTML pages.
    const CATEGORY_ID = 47;
    let api_page = 1;
    while (api_page <= MAX_PAGES) {
      const api_url = `https://zelenoeyabloko.ru/api/store/products?shop_id=${SHOP_ID}&category_id=${CATEGORY_ID}&per_page=50&page=${api_page}`;
      console.error(`[zy-energy] api page ${api_page}: ${api_url}`);
      const { status, text } = await fetch_text(api_url);
      if (status >= 400) throw new Error(`HTTP ${status} at ${api_url}`);
      pages += 1;
      const payload = JSON.parse(text) as {
        paginatorInfo?: { hasMorePages?: boolean; total?: number };
        data?: Array<{
          id: number | string;
          title?: string;
          name?: string;
          image?: string;
          images?: string[];
          price?: { value?: number } | number;
          can_buy?: boolean | number;
          link?: string;
          url?: string;
        }>;
      };
      const rows = payload.data || [];
      let neu = 0;
      for (const p of rows) {
        const id = String(p.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const source_name = String(p.title || p.name || "").trim();
        if (!source_name) continue;
        const price =
          typeof p.price === "number"
            ? p.price
            : typeof p.price?.value === "number"
              ? p.price.value
              : null;
        const image = p.image || p.images?.[0] || "";
        const slug = String(p.link || p.url || "").replace(/^\/+/, "");
        cards.push({
          id,
          source_product_url: slug.startsWith("http")
            ? slug
            : slug
              ? `https://zelenoeyabloko.ru/product/${slug}`
              : `https://zelenoeyabloko.ru/product/${id}`,
          source_name,
          candidate_image_url: image,
          source_price_reference: price,
          can_buy:
            p.can_buy == null ? null : p.can_buy === true || p.can_buy === 1,
          page: api_page,
        });
        neu += 1;
      }
      console.error(
        `[zy-energy] api page ${api_page}: rows=${rows.length} new=${neu} total=${cards.length} catalog_total=${payload.paginatorInfo?.total ?? "?"}`,
      );
      if (!payload.paginatorInfo?.hasMorePages || rows.length === 0) break;
      api_page += 1;
      await sleep(page_delay);
    }

    // HTML crawl as fallback / cross-check (stops when no new ids).
    let page = 1;
    while (page <= MAX_PAGES) {
      const url =
        page === 1 ? CATEGORY.url : `${CATEGORY.url}?page=${page}&sort=popular`;
      console.error(`[zy-energy] html page ${page}: ${url}`);
      const { status, text } = await fetch_text(url);
      if (status >= 400) throw new Error(`HTTP ${status} at ${url}`);
      pages += 1;
      const page_cards = parse_cards(text, page);
      let neu = 0;
      for (const c of page_cards) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        cards.push(c);
        neu += 1;
      }
      console.error(
        `[zy-energy] html page ${page}: cards=${page_cards.length} new=${neu} total=${cards.length}`,
      );
      if (neu === 0) break;
      page += 1;
      await sleep(page_delay);
    }

    const rows: ZyEnergyCandidateRow[] = [];
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i]!;
      let image = card.candidate_image_url;
      let remain: number | null = null;
      try {
        if (!skip_detail) {
          const detail = await enrich(card);
          remain = detail.remain_qty;
          if (detail.image) image = detail.image;
          await sleep(detail_delay);
        }
      } catch (err) {
        scrape_errors.push(
          `enrich ${card.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const parsed = parse_zy_product_name(card.source_name);
      const brand = parsed.brand;
      let flavor =
        clean_flavor(parsed.flavor, brand) ||
        clean_flavor(card.source_name, brand);
      // Classic unflavored energy (e.g. «Берн ж/б») → explicit classic marker
      if (!flavor) flavor = "classic";
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
        sugar_free: parsed.sugar_free,
        candidate_image_url: image,
        source_price_reference: card.source_price_reference,
        availability_reference: availability_text(card.can_buy, remain),
        source_brand: brand,
        source_flavor: flavor,
        source_volume: volume_text,
        source_package: package_type,
        source_priority: 3,
        source_product_id: card.id,
        source_category_slug: CATEGORY.slug,
        source_category_url: CATEGORY.url,
        source_category_title: CATEGORY.title,
        volume_ml: parsed.volume_ml,
        package_code: parsed.package_code,
      });
      if ((i + 1) % 10 === 0) {
        console.error(`[zy-energy] enriched ${i + 1}/${cards.length}`);
        save_progress(out, {
          partial: true,
          pages,
          found: cards.length,
          enriched: i + 1,
          candidates: rows,
          errors: scrape_errors,
        });
      }
    }

    const unique: ZyEnergyCandidateRow[] = [];
    const keys = new Map<string, ZyEnergyCandidateRow>();
    let internal_dupes = 0;
    for (const r of rows) {
      const key = dedupe_key({
        brand: r.brand,
        source_name: r.source_name,
        flavor: r.flavor,
        volume_text: r.volume_text,
        package_type: r.package_type,
        sugar_free: r.sugar_free,
      });
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
      category: CATEGORY,
      pages_processed: pages,
      found: cards.length,
      unique: unique.length,
      internal_duplicates_skipped: internal_dupes,
      sugar_free_true: unique.filter((r) => r.sugar_free === true).length,
      sugar_free_false: unique.filter((r) => r.sugar_free === false).length,
      sugar_free_unknown: unique.filter((r) => r.sugar_free == null).length,
      unknown_package: unique.filter((r) => !r.package_type).length,
      errors: scrape_errors,
      candidates: unique,
    };
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
    writeFileSync(
      out.replace(/candidates\.json$/i, "candidates.flat.json"),
      JSON.stringify(unique, null, 2) + "\n",
    );
    console.error(
      `[zy-energy] done pages=${pages} found=${cards.length} unique=${unique.length} dupes=${internal_dupes} -> ${out}`,
    );
  } catch (err) {
    console.error("[zy-energy] STOPPED:", err);
    process.exitCode = 1;
  }
}

main();
