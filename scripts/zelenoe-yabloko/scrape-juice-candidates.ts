#!/usr/bin/env node
/**
 * Scrape «Зелёное яблоко» juices / nectars / mors → candidates JSON.
 *
 * Categories:
 *   - https://zelenoeyabloko.ru/catalog/soki-nektary-morsy (id=45)
 *   - https://zelenoeyabloko.ru/catalog/voda-soki (id=135, kids — juice-like only)
 *
 * Does NOT change production / VPS / DB / image_url.
 *
 * Output: data/imports/zelenoe-yabloko-juice/candidates.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  detect_juice_product_type,
  detect_kids_line,
  detect_pulp,
  parse_zy_product_name,
  type JuiceProductType,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const CATEGORIES = [
  {
    id: 45,
    slug: "soki-nektary-morsy",
    url: "https://zelenoeyabloko.ru/catalog/soki-nektary-morsy",
    title: "Соки, нектары, морсы",
    kids: false,
    filter_juice_like: false,
  },
  {
    id: 135,
    slug: "voda-soki",
    url: "https://zelenoeyabloko.ru/catalog/voda-soki",
    title: "Вода, соки (детские)",
    kids: true,
    filter_juice_like: true,
  },
] as const;

const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; juice-candidates-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT = "data/imports/zelenoe-yabloko-juice/candidates.json";
const MAX_PAGES = 40;

type ZyCard = {
  id: string;
  source_product_url: string;
  source_name: string;
  candidate_image_url: string;
  source_price_reference: number | null;
  can_buy: boolean | null;
  page: number;
  category_id: number;
  category_slug: string;
  category_url: string;
  category_title: string;
  kids_category: boolean;
};

export type ZyJuiceCandidateRow = {
  source_site: "zelenoeyabloko.ru";
  source_product_url: string;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  sugar_free: boolean | null;
  product_type: JuiceProductType;
  has_pulp: boolean | null;
  is_kids_line: boolean;
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
  source_category_id: number;
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

function is_juice_like_name(name: string): boolean {
  const t = name.toLowerCase();
  if (/^(вода)\b/.test(t) && !/сок/.test(t)) return false;
  if (/лимонад|jumper|энергет/.test(t)) return false;
  return /сок|нектар|морс|сокосодерж|вода\s*и\s*сок/.test(t);
}

function clean_flavor(raw: string, brand: string, product_type: string): string {
  let t = String(raw || "");
  if (brand) {
    const brand_re = new RegExp(
      brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "ig",
    );
    t = t.replace(brand_re, " ");
  }
  return t
    .replace(/напиток|сок|нектар|морс|juice|nectar/gi, " ")
    .replace(/осветл(?:енный|ённый|ен|ён)?|с\s*мякот(?:ью)?|без\s*мякот(?:и)?/gi, " ")
    .replace(/прямого\s*отжима|детск(?:ий|ая|ое)?/gi, " ")
    .replace(/пл\s*\/\s*б|ст\s*\/\s*б|ж\s*\/\s*б|пэт|pet|банка|стекло|тетра|т\s*\/\s*п|п\s*\/\s*бут/gi, " ")
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
  const page_delay = Number(arg("page-delay-ms", "800"));
  const detail_delay = Number(arg("detail-delay-ms", "550"));
  const skip_detail = process.argv.includes("--skip-detail");

  const cards: ZyCard[] = [];
  const seen = new Set<string>();
  let pages = 0;
  const pages_by_category: Record<string, number> = {};
  const scrape_errors: string[] = [];
  const skipped_non_juice: string[] = [];

  try {
    for (const cat of CATEGORIES) {
      pages_by_category[cat.slug] = 0;
      let api_page = 1;
      while (api_page <= MAX_PAGES) {
        const api_url = `https://zelenoeyabloko.ru/api/store/products?shop_id=${SHOP_ID}&category_id=${cat.id}&per_page=50&page=${api_page}`;
        console.error(`[zy-juice] api ${cat.slug} p${api_page}: ${api_url}`);
        const { status, text } = await fetch_text(api_url);
        if (status >= 400) throw new Error(`HTTP ${status} at ${api_url}`);
        pages += 1;
        pages_by_category[cat.slug] += 1;
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
          const source_name = String(p.title || p.name || "").trim();
          if (!source_name) continue;
          if (cat.filter_juice_like && !is_juice_like_name(source_name)) {
            skipped_non_juice.push(source_name);
            continue;
          }
          seen.add(id);
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
            category_id: cat.id,
            category_slug: cat.slug,
            category_url: cat.url,
            category_title: cat.title,
            kids_category: cat.kids,
          });
          neu += 1;
        }
        console.error(
          `[zy-juice] ${cat.slug} p${api_page}: rows=${rows.length} new=${neu} total=${cards.length} catalog_total=${payload.paginatorInfo?.total ?? "?"}`,
        );
        if (!payload.paginatorInfo?.hasMorePages || rows.length === 0) break;
        api_page += 1;
        await sleep(page_delay);
      }
    }

    const rows: ZyJuiceCandidateRow[] = [];
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
      const product_type = detect_juice_product_type(card.source_name);
      const brand = parsed.brand;
      let flavor =
        clean_flavor(parsed.flavor, brand, product_type) ||
        clean_flavor(card.source_name, brand, product_type);
      if (!flavor) flavor = "classic";
      const volume_text = parsed.volume_text || "";
      const package_type = parsed.package_type || "";
      const has_pulp = detect_pulp(card.source_name);
      const is_kids_line =
        card.kids_category ||
        detect_kids_line(card.source_name, card.category_slug);

      rows.push({
        source_site: "zelenoeyabloko.ru",
        source_product_url: card.source_product_url,
        source_name: card.source_name,
        brand,
        flavor,
        volume_text,
        package_type,
        sugar_free: parsed.sugar_free,
        product_type,
        has_pulp,
        is_kids_line,
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
        source_category_id: card.category_id,
        volume_ml: parsed.volume_ml,
        package_code: parsed.package_code,
      });
      if ((i + 1) % 20 === 0) {
        console.error(`[zy-juice] enriched ${i + 1}/${cards.length}`);
        save_progress(out, {
          partial: true,
          pages,
          pages_by_category,
          found: cards.length,
          enriched: i + 1,
          candidates: rows,
          errors: scrape_errors,
        });
      }
    }

    const unique: ZyJuiceCandidateRow[] = [];
    const keys = new Map<string, ZyJuiceCandidateRow>();
    let internal_dupes = 0;
    for (const r of rows) {
      const key =
        dedupe_key({
          brand: r.brand,
          source_name: r.source_name,
          flavor: r.flavor,
          volume_text: r.volume_text,
          package_type: r.package_type,
          sugar_free: r.sugar_free,
        }) +
        `|${r.product_type}|${r.is_kids_line ? "kids" : "adult"}|${
          r.has_pulp === true ? "pulp" : r.has_pulp === false ? "clear" : "pulp?"
        }`;
      if (keys.has(key)) {
        internal_dupes += 1;
        continue;
      }
      keys.set(key, r);
      unique.push(r);
    }

    const by_type = {
      juice: unique.filter((r) => r.product_type === "juice").length,
      nectar: unique.filter((r) => r.product_type === "nectar").length,
      mors: unique.filter((r) => r.product_type === "mors").length,
      juice_drink: unique.filter((r) => r.product_type === "juice_drink").length,
      unknown: unique.filter((r) => r.product_type === "unknown").length,
    };

    const payload = {
      generated_at: new Date().toISOString(),
      note: "LOCAL DRAFT ONLY. Do not create products / change image_url / upload to VPS.",
      categories: CATEGORIES.map((c) => ({
        id: c.id,
        slug: c.slug,
        url: c.url,
        title: c.title,
        kids: c.kids,
      })),
      pages_processed: pages,
      pages_by_category,
      found: cards.length,
      unique: unique.length,
      internal_duplicates_skipped: internal_dupes,
      by_product_type: by_type,
      unknown_package: unique.filter((r) => !r.package_type).length,
      unknown_product_type: by_type.unknown,
      sugar_free_true: unique.filter((r) => r.sugar_free === true).length,
      kids_line: unique.filter((r) => r.is_kids_line).length,
      skipped_non_juice_from_kids_category: skipped_non_juice.length,
      skipped_non_juice_sample: skipped_non_juice.slice(0, 20),
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
      `[zy-juice] done pages=${pages} found=${cards.length} unique=${unique.length} dupes=${internal_dupes} types=${JSON.stringify(by_type)} -> ${out}`,
    );
  } catch (err) {
    console.error("[zy-juice] STOPPED:", err);
    process.exitCode = 1;
  }
}

main();
