#!/usr/bin/env node
/**
 * Scrape «Зелёное яблоко» cold tea / tea drinks / kvass → candidates JSON.
 *
 * Categories:
 *   - https://zelenoeyabloko.ru/catalog/xolodnye-cai (id=249)
 *   - https://zelenoeyabloko.ru/catalog/kvas (id=48)
 *   - https://zelenoeyabloko.ru/catalog/bezalkogolnye-napitki (id=49) — iced-tea only
 *
 * Does NOT change production / VPS / DB / image_url. Does NOT import.
 *
 * Output: data/imports/zelenoe-yabloko-tea-kvass/candidates.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  detect_tea_kvass_product_type,
  parse_zy_product_name,
  type TeaKvassProductType,
} from "../../src/lib/catalog/external-images/zy-parse-name";

const CATEGORIES = [
  {
    id: 249,
    slug: "xolodnye-cai",
    url: "https://zelenoeyabloko.ru/catalog/xolodnye-cai",
    title: "Холодные чаи",
    filter_tea_kvass: false,
  },
  {
    id: 48,
    slug: "kvas",
    url: "https://zelenoeyabloko.ru/catalog/kvas",
    title: "Квас",
    filter_tea_kvass: false,
  },
  {
    id: 49,
    slug: "bezalkogolnye-napitki",
    url: "https://zelenoeyabloko.ru/catalog/bezalkogolnye-napitki",
    title: "Безалкогольные напитки (только холодный чай)",
    filter_tea_kvass: true,
  },
] as const;

const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; tea-kvass-candidates-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT = "data/imports/zelenoe-yabloko-tea-kvass/candidates.json";
const MAX_PAGES = 20;

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
};

export type ZyTeaKvassCandidateRow = {
  source_site: "zelenoeyabloko.ru";
  source_product_url: string;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  sugar_free: boolean | null;
  product_type: TeaKvassProductType;
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

/** Keep iced teas / tea drinks / kombucha from mixed soft-drinks category. */
function is_tea_kvass_like_name(name: string): boolean {
  const t = name.toLowerCase();
  if (/вино|barbican|байкал|vast\b/.test(t)) return false;
  return (
    /холодн\w*\s*чай|чай\s*холодн|ice\s*tea|iced\s*tea|ice\s*bar|айс\s*бар|липтон|nestea|fuze|комбуч|kombucha|чайн\w*\s*напит|квас/.test(
      t,
    ) || /чай/.test(t)
  );
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
    .replace(
      /холодн[а-яё]*\s*чай|чай\s*холодн[а-яё]*|ice\s*tea|iced\s*tea/gi,
      " ",
    )
    .replace(/^ый\s+/i, " ")
    .replace(/чайн[а-яё]*\s*напит|напиток|комбуч[а-яё]*|kombucha/gi, " ")
    .replace(/квасн[а-яё]*\s*напит|квас/gi, " ")
    .replace(
      /пл\s*\/?\s*б|ст\s*\/?\s*б|ж\s*\/?\s*б|пэт|pet|банка|стекло|тетра|т\s*\/?\s*п|п\s*\/?\s*бут/gi,
      " ",
    )
    .replace(/\b(пл|ст|ж)\s*б\b/gi, " ")
    .replace(/зеро|zero|sugar[\s-]?free|без\s*сахара/gi, " ")
    .replace(/со\s*вкусом/gi, " ")
    .replace(/денеб|капитанская\s*бочка/gi, " ")
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

function parse_html_product_ids(html: string): string[] {
  const ids: string[] = [];
  const re = /\/product\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    ids.push(m[1]!);
  }
  return [...new Set(ids)];
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
  const catalog_totals: Record<
    string,
    { category_id: number; slug: string; url: string; title: string; api_total: number | null }
  > = {};
  const scrape_errors: string[] = [];
  const skipped_non_tea_kvass: string[] = [];

  try {
    for (const cat of CATEGORIES) {
      pages_by_category[cat.slug] = 0;
      catalog_totals[cat.slug] = {
        category_id: cat.id,
        slug: cat.slug,
        url: cat.url,
        title: cat.title,
        api_total: null,
      };

      let api_page = 1;
      while (api_page <= MAX_PAGES) {
        const api_url = `https://zelenoeyabloko.ru/api/store/products?shop_id=${SHOP_ID}&category_id=${cat.id}&per_page=50&page=${api_page}`;
        console.error(`[zy-tea-kvass] api ${cat.slug} p${api_page}: ${api_url}`);
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
        if (api_page === 1) {
          catalog_totals[cat.slug]!.api_total =
            payload.paginatorInfo?.total ?? null;
        }
        const rows = payload.data || [];
        let neu = 0;
        for (const p of rows) {
          const id = String(p.id);
          if (seen.has(id)) continue;
          const source_name = String(p.title || p.name || "").trim();
          if (!source_name) continue;
          if (cat.filter_tea_kvass && !is_tea_kvass_like_name(source_name)) {
            skipped_non_tea_kvass.push(source_name);
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
          });
          neu += 1;
        }
        console.error(
          `[zy-tea-kvass] ${cat.slug} p${api_page}: rows=${rows.length} new=${neu} total=${cards.length} catalog_total=${payload.paginatorInfo?.total ?? "?"}`,
        );
        if (!payload.paginatorInfo?.hasMorePages || rows.length === 0) break;
        api_page += 1;
        await sleep(page_delay);
      }

      // HTML page walk (cross-check; related blocks may inflate ids)
      let html_page = 1;
      while (html_page <= MAX_PAGES) {
        const url =
          html_page === 1
            ? cat.url
            : `${cat.url}?page=${html_page}&sort=popular`;
        console.error(`[zy-tea-kvass] html ${cat.slug} p${html_page}: ${url}`);
        const { status, text } = await fetch_text(url);
        if (status >= 400) throw new Error(`HTTP ${status} at ${url}`);
        pages += 1;
        pages_by_category[cat.slug] += 1;
        const ids = parse_html_product_ids(text);
        const unknown_on_page = ids.filter((id) => !seen.has(id));
        console.error(
          `[zy-tea-kvass] html ${cat.slug} p${html_page}: ids=${ids.length} unseen=${unknown_on_page.length}`,
        );
        // Do not add HTML-only related products; stop when no new catalog ids.
        if (unknown_on_page.length === 0 && html_page > 1) break;
        if (ids.length === 0) break;
        html_page += 1;
        await sleep(page_delay);
        if (html_page > 3 && unknown_on_page.length === 0) break;
      }
    }

    const rows: ZyTeaKvassCandidateRow[] = [];
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
      const product_type = detect_tea_kvass_product_type(
        card.source_name,
        card.category_slug,
      );
      const brand = parsed.brand;
      let flavor =
        clean_flavor(parsed.flavor, brand) ||
        clean_flavor(card.source_name, brand);
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
        product_type,
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
      if ((i + 1) % 10 === 0) {
        console.error(`[zy-tea-kvass] enriched ${i + 1}/${cards.length}`);
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

    const unique: ZyTeaKvassCandidateRow[] = [];
    const keys = new Map<string, ZyTeaKvassCandidateRow>();
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
        }) + `|${r.product_type}`;
      if (keys.has(key)) {
        internal_dupes += 1;
        continue;
      }
      keys.set(key, r);
      unique.push(r);
    }

    const by_type: Record<TeaKvassProductType, number> = {
      iced_tea: unique.filter((r) => r.product_type === "iced_tea").length,
      tea_drink: unique.filter((r) => r.product_type === "tea_drink").length,
      kombucha: unique.filter((r) => r.product_type === "kombucha").length,
      kvass: unique.filter((r) => r.product_type === "kvass").length,
      kvass_drink: unique.filter((r) => r.product_type === "kvass_drink").length,
      unknown: unique.filter((r) => r.product_type === "unknown").length,
    };

    const products_per_category: Record<string, number> = {};
    for (const r of unique) {
      products_per_category[r.source_category_slug] =
        (products_per_category[r.source_category_slug] || 0) + 1;
    }

    const payload = {
      generated_at: new Date().toISOString(),
      note: "LOCAL DRAFT ONLY. Do not create products / change image_url / upload to VPS.",
      categories: CATEGORIES.map((c) => ({
        id: c.id,
        slug: c.slug,
        url: c.url,
        title: c.title,
        filter_tea_kvass: c.filter_tea_kvass,
        api_total: catalog_totals[c.slug]?.api_total ?? null,
        collected: products_per_category[c.slug] || 0,
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
      skipped_non_tea_kvass_from_mixed_category: skipped_non_tea_kvass.length,
      skipped_non_tea_kvass_sample: skipped_non_tea_kvass.slice(0, 20),
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
      `[zy-tea-kvass] done pages=${pages} found=${cards.length} unique=${unique.length} dupes=${internal_dupes} types=${JSON.stringify(by_type)} -> ${out}`,
    );
  } catch (err) {
    console.error("[zy-tea-kvass] STOPPED:", err);
    process.exitCode = 1;
  }
}

main();
