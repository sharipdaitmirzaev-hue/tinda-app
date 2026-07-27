#!/usr/bin/env node
/**
 * Scrape remaining Zelenoe drink categories not yet inventoried:
 *   - kompoty (id=46)
 *   - bezalkogolnye-napitki (id=49) — excluding already-collected ICE BAR / prior categories / TINDA exacts
 *   - toniziruiushhie-napitki (id=250)
 *
 * LOCAL DRAFT ONLY. No production / VPS / DB / import.
 *
 * Output: data/imports/zelenoe-yabloko-remaining-drinks/candidates.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  dedupe_key,
  detect_remaining_drink_product_type,
  parse_zy_product_name,
  type RemainingDrinkProductType,
} from "../../src/lib/catalog/external-images/zy-parse-name";
import {
  lower,
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
} from "../../src/lib/catalog/external-images/normalize";

const CATEGORIES = [
  {
    id: 46,
    slug: "kompoty",
    url: "https://zelenoeyabloko.ru/catalog/kompoty",
    title: "Компоты",
  },
  {
    id: 49,
    slug: "bezalkogolnye-napitki",
    url: "https://zelenoeyabloko.ru/catalog/bezalkogolnye-napitki",
    title: "Безалкогольные напитки",
  },
  {
    id: 250,
    slug: "toniziruiushhie-napitki",
    url: "https://zelenoeyabloko.ru/catalog/toniziruiushhie-napitki",
    title: "Тонизирующие напитки",
  },
] as const;

const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; remaining-drinks-draft)";
const SHOP_ID = 4;
const DEFAULT_OUT =
  "data/imports/zelenoe-yabloko-remaining-drinks/candidates.json";
const MAX_PAGES = 20;

/** ICE BAR product ids already collected in tea-kvass. */
const ICE_BAR_EXCLUDED_IDS = new Set(["12585", "12581", "12584", "12580"]);

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

export type ZyRemainingDrinkRow = {
  source_site: "zelenoeyabloko.ru";
  source_product_url: string;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  sugar_free: boolean | null;
  product_type: RemainingDrinkProductType;
  highlight_tags: string[];
  misclassified_hint: string | null;
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

function load_json_array(p: string): unknown[] {
  if (!existsSync(p)) return [];
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.candidates)) return data.candidates;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function prior_identity_keys(): Set<string> {
  const keys = new Set<string>();
  const files = [
    "data/imports/zelenoe-yabloko-tea-kvass/candidates.flat.json",
    "data/imports/zelenoe-yabloko-energy/candidates.flat.json",
    "data/imports/zelenoe-yabloko-juice/candidates.flat.json",
    "data/imports/zelenoe-yabloko-water/candidates.flat.json",
    "data/imports/zelenoe_yabloko_gazirovannye_candidates.json",
  ];
  for (const f of files) {
    for (const row of load_json_array(f) as Array<Record<string, unknown>>) {
      const name = String(row.source_name || row.name || "");
      const brand = String(row.brand || row.source_brand || "");
      const volume = String(row.volume_text || row.source_volume || "");
      const pkg = String(row.package_type || row.source_package || "");
      keys.add(identity_key(name, brand, volume, pkg));
      const id = String(row.source_product_id || "");
      if (id) keys.add(`id:${id}`);
    }
  }
  return keys;
}

function tinda_identity_keys(): Set<string> {
  const keys = new Set<string>();
  const snap = path.resolve("data/imports/tinda_active_products.snapshot.json");
  if (!existsSync(snap)) return keys;
  const products = JSON.parse(readFileSync(snap, "utf8")) as Array<{
    name?: string;
    brand?: string;
    volume_text?: string;
    package_type?: string;
  }>;
  for (const p of products) {
    keys.add(
      identity_key(
        String(p.name || ""),
        String(p.brand || ""),
        String(p.volume_text || ""),
        String(p.package_type || ""),
      ),
    );
  }
  return keys;
}

function identity_key(
  name: string,
  brand: string,
  volume: string,
  pkg: string,
): string {
  return [
    normalize_brand(brand) || lower(brand),
    lower(name).replace(/[^a-zа-я0-9]+/gi, " ").trim(),
    String(parse_volume_ml(volume) ?? parse_volume_ml(name) ?? ""),
    normalize_package(pkg || name) || "",
    sugar_free_flag(name) === true
      ? "sf"
      : sugar_free_flag(name) === false
        ? "reg"
        : "unk",
  ].join("|");
}

/** Already covered by tea / kvass / energy / water / soda pipelines. */
function is_already_covered_category_product(name: string): boolean {
  const t = lower(name);
  if (/холодн[а-яё]*\s*чай|чай\s*холодн|ice\s*tea|iced\s*tea|ice\s*bar/.test(t)) {
    return true;
  }
  if (/квас/.test(t)) return true;
  if (/энергет|energy\s*drink|\bburn\b|\bберн\b|red\s*bull|monster/.test(t)) {
    return true;
  }
  if (/^вода\b|мин\.?\s*вода|минеральн|негаз|газированн\w*\s*вода/.test(t)) {
    return true;
  }
  return false;
}

function highlight_tags(
  name: string,
  product_type: RemainingDrinkProductType,
): string[] {
  const t = lower(name);
  const tags: string[] = [];
  if (/barbican/.test(t)) tags.push("barbican");
  if (/(?<![a-zа-я])vast(?![a-zа-я])/.test(t)) tags.push("vast");
  if (/malt|солодов|ячмен/.test(t) || product_type === "malt_drink") {
    tags.push("malt_drink");
  }
  if (/коктейл|моктейл|mocktail|cocktail/.test(t)) tags.push("na_cocktail");
  if (/тоник|tonic/.test(t) || product_type === "tonic_drink") tags.push("tonic");
  if (/функционал|спортивн|l[\s-]?карнитин|l[\s-]?carnitin|изотон/.test(t)) {
    tags.push("functional");
  }
  if (/вино/.test(t)) tags.push("na_wine");
  if (/компот/.test(t) || product_type === "compote") tags.push("compote");
  return tags;
}

function misclassified_hint(
  name: string,
  category_slug: string,
  product_type: RemainingDrinkProductType,
): string | null {
  const t = lower(name);
  if (category_slug === "bezalkogolnye-napitki") {
    if (/байкал/.test(t) && /черноголовк/.test(t)) {
      return "likely_soft_drink_gazirovka";
    }
    if (/холодн|ice\s*bar|квас|энергет/.test(t)) {
      return "belongs_in_other_drink_category";
    }
  }
  if (category_slug === "toniziruiushhie-napitki" && product_type === "other") {
    return "unclear_tonic_fit";
  }
  if (/вино/.test(t) && !/безалкогол/.test(t)) {
    return "possible_alcohol";
  }
  return null;
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
    .replace(/компот|напиток|безалкогольн[а-яё]*|вино|тоник|спортивн[а-яё]*/gi, " ")
    .replace(/malt|солодов[а-яё]*|ячмен[а-яё]*/gi, " ")
    .replace(/пл\s*\/?\s*б|ст\s*\/?\s*б|ж\s*\/?\s*б|пэт|pet|банка|стекло|тетра/gi, " ")
    // «ст» / «ст.» glass shorthand — after ст/б; avoid \b (Cyrillic is non-word in JS)
    .replace(/(?:^|[\s,./(])ст(?:\.|(?=[\s,)/]|$))/giu, " ")
    .replace(/(?:^|[\s,./(])пл(?:\.|(?=[\s,)/]|$))/giu, " ")
    .replace(/(?:^|\s)\/?\s*б(?:\s|$)/giu, " ")
    .replace(/зеро|zero|sugar[\s-]?free|без\s*сахара/gi, " ")
    .replace(/selection\s*rot|cabernet|sauvignon|merlot|riesling/gi, (m) => m)
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

  const prior_keys = prior_identity_keys();
  const tinda_keys = tinda_identity_keys();

  const cards: ZyCard[] = [];
  const seen = new Set<string>();
  let pages = 0;
  const pages_by_category: Record<string, number> = {};
  const catalog_totals: Record<string, number | null> = {};
  const scrape_errors: string[] = [];
  const skipped: Array<{ reason: string; name: string; id: string }> = [];

  try {
    for (const cat of CATEGORIES) {
      pages_by_category[cat.slug] = 0;
      let api_page = 1;
      while (api_page <= MAX_PAGES) {
        const api_url = `https://zelenoeyabloko.ru/api/store/products?shop_id=${SHOP_ID}&category_id=${cat.id}&per_page=50&page=${api_page}`;
        console.error(`[zy-remaining] api ${cat.slug} p${api_page}`);
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
          catalog_totals[cat.slug] = payload.paginatorInfo?.total ?? null;
        }
        const rows = payload.data || [];
        let neu = 0;
        for (const p of rows) {
          const id = String(p.id);
          if (seen.has(id)) continue;
          const source_name = String(p.title || p.name || "").trim();
          if (!source_name) continue;

          if (ICE_BAR_EXCLUDED_IDS.has(id) || /ice\s*bar/i.test(source_name)) {
            skipped.push({
              reason: "excluded_ice_bar_tea_kvass",
              name: source_name,
              id,
            });
            continue;
          }
          if (is_already_covered_category_product(source_name)) {
            skipped.push({
              reason: "excluded_covered_by_prior_category_pipeline",
              name: source_name,
              id,
            });
            continue;
          }
          if (prior_keys.has(`id:${id}`)) {
            skipped.push({
              reason: "excluded_prior_collection_id",
              name: source_name,
              id,
            });
            continue;
          }

          const parsed_tmp = parse_zy_product_name(source_name);
          const ident = identity_key(
            source_name,
            parsed_tmp.brand,
            parsed_tmp.volume_text || "",
            parsed_tmp.package_type || "",
          );
          if (prior_keys.has(ident)) {
            skipped.push({
              reason: "excluded_prior_collection_identity",
              name: source_name,
              id,
            });
            continue;
          }
          if (tinda_keys.has(ident)) {
            skipped.push({
              reason: "excluded_already_in_tinda",
              name: source_name,
              id,
            });
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
          `[zy-remaining] ${cat.slug} p${api_page}: rows=${rows.length} new=${neu} total=${cards.length}`,
        );
        if (!payload.paginatorInfo?.hasMorePages || rows.length === 0) break;
        api_page += 1;
        await sleep(page_delay);
      }
    }

    const rows: ZyRemainingDrinkRow[] = [];
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
      const product_type = detect_remaining_drink_product_type(
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
      const tags = highlight_tags(card.source_name, product_type);
      const mis = misclassified_hint(
        card.source_name,
        card.category_slug,
        product_type,
      );

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
        highlight_tags: tags,
        misclassified_hint: mis,
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
    }

    const unique: ZyRemainingDrinkRow[] = [];
    const keys = new Map<string, ZyRemainingDrinkRow>();
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

    const by_type: Record<RemainingDrinkProductType, number> = {
      compote: unique.filter((r) => r.product_type === "compote").length,
      malt_drink: unique.filter((r) => r.product_type === "malt_drink").length,
      non_alcoholic_drink: unique.filter(
        (r) => r.product_type === "non_alcoholic_drink",
      ).length,
      tonic_drink: unique.filter((r) => r.product_type === "tonic_drink")
        .length,
      other: unique.filter((r) => r.product_type === "other").length,
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
        api_total: catalog_totals[c.slug] ?? null,
        collected: products_per_category[c.slug] || 0,
      })),
      pages_processed: pages,
      pages_by_category,
      found_raw: cards.length,
      unique: unique.length,
      internal_duplicates_skipped: internal_dupes,
      by_product_type: by_type,
      unknown_package: unique.filter((r) => !r.package_type).length,
      unknown_product_type: by_type.unknown,
      skipped_count: skipped.length,
      skipped_by_reason: skipped.reduce(
        (acc, s) => {
          acc[s.reason] = (acc[s.reason] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      skipped_sample: skipped.slice(0, 30),
      highlights: {
        barbican: unique.filter((r) => r.highlight_tags.includes("barbican"))
          .length,
        vast: unique.filter((r) => r.highlight_tags.includes("vast")).length,
        malt_drink: by_type.malt_drink,
        tonic: unique.filter((r) => r.highlight_tags.includes("tonic")).length,
        functional: unique.filter((r) =>
          r.highlight_tags.includes("functional"),
        ).length,
        na_cocktail: unique.filter((r) =>
          r.highlight_tags.includes("na_cocktail"),
        ).length,
        misclassified: unique.filter((r) => !!r.misclassified_hint).length,
      },
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
      `[zy-remaining] done pages=${pages} found=${cards.length} unique=${unique.length} skipped=${skipped.length} types=${JSON.stringify(by_type)} -> ${out}`,
    );
  } catch (err) {
    console.error("[zy-remaining] STOPPED:", err);
    process.exitCode = 1;
  }
}

main();
