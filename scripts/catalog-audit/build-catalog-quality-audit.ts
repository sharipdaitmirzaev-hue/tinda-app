#!/usr/bin/env node
/**
 * Read-only TINDA catalog quality audit after mass imports.
 *
 * Input: CSV export of active products (+ interest counts).
 * Output:
 *   data/reports/catalog-quality-audit.xlsx
 *   data/reports/catalog-quality-audit.json
 *
 * Does NOT change production / VPS / DB / prices / image_url.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  extract_flavor_hint,
  lower,
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
  token_overlap,
  translit,
} from "../../src/lib/catalog/external-images/normalize";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve("data/reports");
const DEFAULT_CSV = path.join(ROOT, "catalog-active-products.export.csv");
const OUT_XLSX = path.join(ROOT, "catalog-quality-audit.xlsx");
const OUT_JSON = path.join(ROOT, "catalog-quality-audit.json");

const KNOWN_PACKAGES = new Set([
  "pet",
  "glass",
  "can",
  "carton",
  "pouch",
  "pack",
]);

/** Brands preferred for first sales launch. */
const PRIORITY_BRANDS = [
  "coca-cola",
  "кока-кола",
  "sprite",
  "спрайт",
  "fanta",
  "фанта",
  "rich",
  "рич",
  "добрый",
  "burn",
  "берн",
  "red bull",
  "ред булл",
  "monster",
  "боржоми",
  "borjomi",
  "lipton",
  "липтон",
  "очаковский",
  "вятский",
  "лидский",
  "j7",
  "фрутоняня",
  "агуша",
  "сады придонья",
  "любимый",
  "вико",
  "evervess",
  "laimon",
  "лаймон",
  "ice bar",
  "ice day",
  "денеб",
  "сулакский",
];

const POPULAR_CATEGORIES = new Set([
  "gazirovannye-napitki",
  "gazirovka",
  "kola",
  "limonady",
  "energeticheskie-napitki",
  "voda-gazirovannaya",
  "voda-negazirovannaya",
  "voda-mineralnaya",
  "voda-pitevaya",
  "sok",
  "nektar",
  "mors",
  "kholodnyy-chay",
  "kvas",
]);

type RawRow = Record<string, string>;

type AuditRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  brand_norm: string;
  category_slug: string;
  category_name: string;
  category_is_active: boolean;
  volume_text: string;
  volume_ml: number | null;
  package_type: string;
  package_norm: string;
  package_unknown: boolean;
  units_per_package: number;
  sales_status: string;
  price_amount: number | null;
  price_currency: string;
  availability: string;
  image_url: string;
  local_or_external: "local" | "external" | "missing";
  image_broken: boolean;
  is_new: boolean;
  is_promo: boolean;
  is_hit: boolean;
  interest_count: number;
  flavor: string;
  sugar_free: boolean | null;
  sku_has_unk: boolean;
  missing_brand: boolean;
  missing_volume: boolean;
  incomplete_name: boolean;
  incomplete_brand_or_flavor: boolean;
  units_eq_1: boolean;
  dupe_key: string;
  possible_duplicate_skus: string[];
  possible_duplicate_count: number;
  similar_name_skus: string[];
  similar_name_count: number;
  review_priority: "high" | "medium" | "low";
  priority_reasons: string[];
  ready_to_sell: boolean;
  ready_blockers: string[];
  recommended_action: string;
  top50_score: number;
  in_top50: boolean;
};

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

/** Minimal RFC4180-ish CSV parser (header required). */
function parse_csv(text: string): RawRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let in_quotes = false;
  const s = text.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const ch = s[i]!;
    if (in_quotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        in_quotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      in_quotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || (ch === "\r" && s[i + 1] === "\n")) {
      row.push(field);
      field = "";
      if (row.length) rows.push(row);
      row = [];
      i += ch === "\r" ? 2 : 1;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      field = "";
      if (row.length) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj: RawRow = {};
    for (let c = 0; c < header.length; c += 1) {
      obj[header[c]!] = cols[c] ?? "";
    }
    return obj;
  });
}

function bool(v: string): boolean {
  return v === "t" || v === "true" || v === "1";
}

function num_or_null(v: string): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function is_local_image(url: string): boolean {
  return /^\/uploads\//i.test(url);
}

function is_external_image(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function package_is_unknown(raw: string, norm: string): boolean {
  const t = lower(raw);
  if (!t) return true;
  if (t === "unknown" || t === "unk" || t === "неизвестно" || t === "другое") {
    return true;
  }
  if (!norm) return true;
  if (norm === "other") return true;
  // Cyrillic "бутылка" without PET/glass hint → treat as unknown packaging kind
  if (norm === "butylka" || norm === "bottle") return true;
  return !KNOWN_PACKAGES.has(norm);
}

function clean_flavor(
  name: string,
  brand: string,
  volume: string,
  pkg: string,
): string {
  let f = extract_flavor_hint(name, brand, volume, pkg);
  f = f
    .replace(
      /\b(напиток|газир(?:ованный)?|газ|сок|нектар|морс|квас|чай|вода)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return f || "classic";
}

function dupe_key_of(p: {
  brand_norm: string;
  flavor: string;
  volume_ml: number | null;
  package_norm: string;
  sugar_free: boolean | null;
}): string {
  return [
    p.brand_norm || "?",
    lower(p.flavor) || "?",
    p.volume_ml == null ? "?" : String(p.volume_ml),
    p.package_norm || "?",
    p.sugar_free === true ? "sf" : p.sugar_free === false ? "reg" : "unk",
  ].join("|");
}

function name_tokens(name: string, brand: string): Set<string> {
  const cleaned = lower(name)
    .replace(lower(brand), " ")
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)/gi, " ")
    .replace(
      /(пэт|pet|стекло|банка|ж\/б|пл\/б|тетра|carton|упаковка|бутылка)/gi,
      " ",
    );
  const parts = translit(cleaned)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return new Set(parts);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function brand_is_priority(brand: string): boolean {
  const b = lower(brand);
  const bt = lower(translit(b));
  return PRIORITY_BRANDS.some((x) => {
    const xl = lower(x);
    const xt = lower(translit(x));
    return b.includes(xl) || bt.includes(xt);
  });
}

function incomplete_name(name: string): boolean {
  const t = String(name || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 12) return true;
  const stripped = t
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length < 8;
}

function recommend(row: AuditRow): string {
  if (row.ready_to_sell) {
    return "Уточнить закупочную цену → назначить продажную цену → перевести в orderable";
  }
  const acts: string[] = [];
  if (row.interest_count > 0) acts.push("Приоритет: есть спрос (interest)");
  if (row.sku_has_unk) acts.push("Исправить SKU (убрать UNK / уточнить упаковку)");
  if (row.package_unknown) {
    acts.push("Определить package_type (PET/glass/can/carton)");
  }
  if (row.possible_duplicate_count > 0) {
    acts.push(
      `Проверить дубли: ${row.possible_duplicate_skus.slice(0, 5).join(", ")}`,
    );
  }
  if (row.image_broken) acts.push("Добавить локальное изображение");
  else if (row.local_or_external === "external") {
    acts.push("Заменить внешнее изображение на локальный /uploads");
  }
  if (row.missing_brand) acts.push("Заполнить бренд");
  if (row.missing_volume) acts.push("Заполнить объём");
  if (row.incomplete_brand_or_flavor) acts.push("Уточнить бренд/вкус в названии");
  if (row.units_eq_1 && row.sales_status === "showcase") {
    acts.push("Уточнить units_per_package (транспортная упаковка)");
  }
  if (row.sales_status === "orderable" && row.price_amount == null) {
    acts.push(
      "CRITICAL: orderable без цены — назначить цену или вернуть в showcase",
    );
  }
  if (!acts.length) acts.push("Карточка в порядке — мониторинг");
  return acts.join("; ");
}

function compute_priority(row: AuditRow): {
  priority: "high" | "medium" | "low";
  reasons: string[];
} {
  const high: string[] = [];
  if (row.interest_count > 0) high.push("interest");
  if (row.sku_has_unk) high.push("sku_unk");
  if (row.package_unknown) high.push("package_unknown");
  if (row.possible_duplicate_count >= 2) high.push("multiple_dupes");
  if (row.image_broken) high.push("broken_image");
  // Ready-to-sell with demand or already flagged issues stays high via interest/etc.
  // Plain ready_to_sell alone is NOT a review defect — see low criteria.
  if (
    row.sales_status === "orderable" &&
    (row.price_amount == null || row.image_broken || row.package_unknown)
  ) {
    high.push("orderable_incomplete");
  }
  // Showcase ready cards that are in top-50 launch list → "готовится к orderable"
  if (row.ready_to_sell && row.in_top50 && row.sales_status !== "orderable") {
    high.push("ready_for_orderable");
  }

  if (high.length) return { priority: "high", reasons: high };

  const med: string[] = [];
  if (row.units_eq_1) med.push("units_per_package_1");
  if (row.incomplete_name) med.push("incomplete_name");
  if (row.local_or_external === "external") med.push("external_cdn");
  if (row.incomplete_brand_or_flavor) med.push("incomplete_brand_or_flavor");
  if (row.possible_duplicate_count === 1) med.push("possible_dupe");
  if (row.similar_name_count > 0) med.push("similar_names");

  if (med.length) return { priority: "medium", reasons: med };

  return {
    priority: "low",
    reasons: ["complete_card", "local_image", "no_conflicts"],
  };
}

function top50_score(row: AuditRow): number {
  let s = 0;
  if (brand_is_priority(row.brand)) s += 30;
  if (POPULAR_CATEGORIES.has(row.category_slug)) s += 20;
  if (row.interest_count > 0) s += 25 + Math.min(row.interest_count, 5) * 3;
  if (row.ready_to_sell) s += 25;
  if (row.local_or_external === "local") s += 15;
  if (!row.package_unknown) s += 10;
  if (!row.missing_brand && !row.missing_volume) s += 10;
  if (row.possible_duplicate_count === 0) s += 10;
  if (row.image_broken) s -= 40;
  if (row.sku_has_unk) s -= 20;
  if (row.package_unknown) s -= 15;
  if (row.possible_duplicate_count > 0) s -= 10 * row.possible_duplicate_count;
  if (row.is_hit) s += 5;
  if (row.is_new) s += 3;
  if (row.sales_status === "orderable" && row.price_amount != null) s += 8;
  return s;
}

function sheet_rows(rows: AuditRow[]) {
  return rows.map((r) => ({
    SKU: r.sku,
    Название: r.name,
    Бренд: r.brand,
    Категория: r.category_name,
    "Категория slug": r.category_slug,
    Объём: r.volume_text,
    "Объём мл": r.volume_ml,
    package_type: r.package_type,
    package_norm: r.package_norm,
    units_per_package: r.units_per_package,
    sales_status: r.sales_status,
    price: r.price_amount,
    availability: r.availability,
    image_url: r.image_url,
    local_or_external: r.local_or_external,
    interest_count: r.interest_count,
    flavor: r.flavor,
    sugar_free: r.sugar_free == null ? "" : r.sugar_free ? "yes" : "no",
    possible_duplicate_count: r.possible_duplicate_count,
    possible_duplicate_skus: r.possible_duplicate_skus.join(", "),
    similar_name_count: r.similar_name_count,
    similar_name_skus: r.similar_name_skus.join(", "),
    review_priority: r.review_priority,
    priority_reasons: r.priority_reasons.join("|"),
    ready_to_sell: r.ready_to_sell ? "yes" : "no",
    recommended_action: r.recommended_action,
    top50_score: r.top50_score,
    in_top50: r.in_top50 ? "yes" : "no",
  }));
}

function main() {
  const csv_path = path.resolve(arg("csv", DEFAULT_CSV)!);
  const raw = readFileSync(csv_path, "utf8");
  const records = parse_csv(raw);

  const rows: AuditRow[] = records.map((r) => {
    const name = String(r.name || "").trim();
    const brand = String(r.brand || "").trim();
    const volume_text = String(r.volume_text || "").trim();
    const package_type = String(r.package_type || "").trim();
    const image_url = String(r.image_url || "").trim();
    const brand_norm = normalize_brand(brand) || lower(brand);
    const package_norm = normalize_package(package_type || name);
    const volume_ml = parse_volume_ml(volume_text) ?? parse_volume_ml(name);
    const sugar = sugar_free_flag(`${name} ${brand}`);
    const flavor = clean_flavor(name, brand, volume_text, package_type);
    const package_unknown = package_is_unknown(package_type, package_norm);
    const missing_brand =
      !brand || brand_norm.length < 2 || /^unknown$/i.test(brand);
    const missing_volume = volume_ml == null;
    const local_or_external: AuditRow["local_or_external"] = !image_url
      ? "missing"
      : is_local_image(image_url)
        ? "local"
        : is_external_image(image_url)
          ? "external"
          : "missing";
    const image_broken = local_or_external === "missing";
    const incomplete_bf = missing_brand || flavor.length < 2;

    const base: AuditRow = {
      id: String(r.id),
      sku: String(r.sku || "").trim(),
      name,
      brand,
      brand_norm,
      category_slug: String(r.category_slug || "").trim(),
      category_name: String(r.category_name || "").trim(),
      category_is_active: bool(String(r.category_is_active || "t")),
      volume_text,
      volume_ml,
      package_type,
      package_norm,
      package_unknown,
      units_per_package: Number(r.units_per_package || 0),
      sales_status: String(r.sales_status || "").trim(),
      price_amount: num_or_null(String(r.price_amount || "")),
      price_currency: String(r.price_currency || "RUB"),
      availability: String(r.availability || "").trim(),
      image_url,
      local_or_external,
      image_broken,
      is_new: bool(String(r.is_new || "")),
      is_promo: bool(String(r.is_promo || "")),
      is_hit: bool(String(r.is_hit || "")),
      interest_count: Number(r.interest_count || 0),
      flavor,
      sugar_free: sugar,
      sku_has_unk: /(?:^|[-_])UNK(?:$|[-_])/i.test(String(r.sku || "")),
      missing_brand,
      missing_volume,
      incomplete_name: incomplete_name(name),
      incomplete_brand_or_flavor: incomplete_bf,
      units_eq_1: Number(r.units_per_package || 0) === 1,
      dupe_key: "",
      possible_duplicate_skus: [],
      possible_duplicate_count: 0,
      similar_name_skus: [],
      similar_name_count: 0,
      review_priority: "low",
      priority_reasons: [],
      ready_to_sell: false,
      ready_blockers: [],
      recommended_action: "",
      top50_score: 0,
      in_top50: false,
    };
    base.dupe_key = dupe_key_of(base);
    return base;
  });

  // Exact attribute duplicates (same brand+flavor+volume+package+sugar)
  const by_dupe = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const list = by_dupe.get(r.dupe_key) || [];
    list.push(r);
    by_dupe.set(r.dupe_key, list);
  }
  for (const group of by_dupe.values()) {
    if (group.length < 2) continue;
    const sample = group[0]!;
    // Too-weak keys (all unknown) — skip
    if (
      sample.volume_ml == null &&
      (!sample.package_norm || sample.package_unknown) &&
      sample.flavor === "classic"
    ) {
      continue;
    }
    for (const r of group) {
      r.possible_duplicate_skus = group
        .filter((x) => x.sku !== r.sku)
        .map((x) => x.sku);
      r.possible_duplicate_count = r.possible_duplicate_skus.length;
    }
  }

  // Probable dupes: same brand + volume + package + sugar, near-identical flavor
  const by_core = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const core = [
      r.brand_norm || "?",
      r.volume_ml == null ? "?" : String(r.volume_ml),
      r.package_norm || "?",
      r.sugar_free === true ? "sf" : r.sugar_free === false ? "reg" : "unk",
    ].join("|");
    const list = by_core.get(core) || [];
    list.push(r);
    by_core.set(core, list);
  }
  for (const group of by_core.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.dupe_key === b.dupe_key) continue; // already exact
        const fov = token_overlap(a.flavor, b.flavor);
        const nov = token_overlap(a.name, b.name);
        // Same flavor (or empty/classic both) + very similar name → probable dupe
        const flavor_same =
          lower(a.flavor) === lower(b.flavor) ||
          fov >= 0.85 ||
          (a.flavor === "classic" && b.flavor === "classic" && nov >= 0.9);
        if (!flavor_same) continue;
        if (!a.possible_duplicate_skus.includes(b.sku)) {
          a.possible_duplicate_skus.push(b.sku);
          a.possible_duplicate_count = a.possible_duplicate_skus.length;
        }
        if (!b.possible_duplicate_skus.includes(a.sku)) {
          b.possible_duplicate_skus.push(a.sku);
          b.possible_duplicate_count = b.possible_duplicate_skus.length;
        }
      }
    }
  }

  // Suspicious similar names: same brand + high overlap, different dupe_key
  const by_brand = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const k = r.brand_norm || lower(r.brand) || "?";
    const list = by_brand.get(k) || [];
    list.push(r);
    by_brand.set(k, list);
  }
  for (const group of by_brand.values()) {
    if (group.length < 2) continue;
    const tokens = group.map((r) => name_tokens(r.name, r.brand));
    for (let i = 0; i < group.length; i += 1) {
      const similar: string[] = [];
      for (let j = 0; j < group.length; j += 1) {
        if (i === j) continue;
        const a = group[i]!;
        const b = group[j]!;
        if (a.dupe_key === b.dupe_key) continue;
        const jac = jaccard(tokens[i]!, tokens[j]!);
        const ov = token_overlap(a.name, b.name);
        if (jac >= 0.72 || ov >= 0.78) similar.push(b.sku);
      }
      if (similar.length) {
        group[i]!.similar_name_skus = [...new Set(similar)].slice(0, 12);
        group[i]!.similar_name_count = group[i]!.similar_name_skus.length;
      }
    }
  }

  for (const r of rows) {
    const blockers: string[] = [];
    if (r.local_or_external !== "local") blockers.push("image_not_local");
    if (r.missing_brand) blockers.push("brand_missing");
    if (r.missing_volume) blockers.push("volume_missing");
    if (r.package_unknown) blockers.push("package_unknown");
    if (!r.category_is_active) blockers.push("category_inactive");
    if (!(r.units_per_package > 0)) blockers.push("units_invalid");
    if (r.possible_duplicate_count > 0) blockers.push("has_duplicates");
    if (r.sku_has_unk) blockers.push("sku_unk");
    if (r.image_broken) blockers.push("broken_image");
    r.ready_blockers = blockers;
    r.ready_to_sell = blockers.length === 0;
  }

  // Score first, pick top-50 with brand/category diversity, then priority.
  for (const r of rows) {
    r.top50_score = top50_score(r);
  }

  const ranked = [...rows]
    .filter((r) => !r.image_broken && !r.sku_has_unk)
    .sort((a, b) => {
      if (b.interest_count !== a.interest_count) {
        return b.interest_count - a.interest_count;
      }
      if (b.top50_score !== a.top50_score) return b.top50_score - a.top50_score;
      return a.sku.localeCompare(b.sku);
    });

  const top50: AuditRow[] = [];
  const brand_counts = new Map<string, number>();
  const cat_counts = new Map<string, number>();
  const MAX_PER_BRAND = 3;
  const MAX_PER_CAT = 10;
  const MUST_COVER_CATS = [
    "kola",
    "kholodnyy-chay",
    "energeticheskie-napitki",
    "kvas",
    "voda-gazirovannaya",
    "voda-negazirovannaya",
    "sok",
    "nektar",
    "gazirovannye-napitki",
    "limonady",
  ];

  function try_add(r: AuditRow, relax_brand = false): boolean {
    if (top50.includes(r)) return false;
    const b = r.brand_norm || lower(r.brand);
    const c = r.category_slug;
    const bc = brand_counts.get(b) || 0;
    const cc = cat_counts.get(c) || 0;
    if (!relax_brand && bc >= MAX_PER_BRAND) return false;
    if (cc >= MAX_PER_CAT) return false;
    top50.push(r);
    brand_counts.set(b, bc + 1);
    cat_counts.set(c, cc + 1);
    return true;
  }

  // Pass 0: interest first
  for (const r of ranked) {
    if (top50.length >= 50) break;
    if (r.interest_count > 0) try_add(r, true);
  }

  // Pass 0b: ensure coverage of key categories with best ready local cards
  for (const cat of MUST_COVER_CATS) {
    if (top50.length >= 50) break;
    if ((cat_counts.get(cat) || 0) > 0) continue;
    const cand = ranked.find(
      (r) =>
        r.category_slug === cat &&
        r.ready_to_sell &&
        r.local_or_external === "local",
    ) || ranked.find((r) => r.category_slug === cat && !r.image_broken);
    if (cand) try_add(cand, true);
  }

  // Pass 1: interest + ready priority brands
  for (const r of ranked) {
    if (top50.length >= 50) break;
    if (
      r.interest_count > 0 ||
      r.ready_to_sell ||
      (r.sales_status === "orderable" && r.price_amount != null)
    ) {
      try_add(r);
    }
  }
  // Pass 2: fill remaining by score
  for (const r of ranked) {
    if (top50.length >= 50) break;
    if (r.possible_duplicate_count > 0) continue;
    if (r.package_unknown) continue;
    try_add(r);
  }
  // Pass 3: relax brand cap if still short
  if (top50.length < 50) {
    for (const r of ranked) {
      if (top50.length >= 50) break;
      if (r.package_unknown || r.possible_duplicate_count > 0) continue;
      try_add(r, true);
    }
  }

  const top50_set = new Set(top50.map((r) => r.sku));
  for (const r of rows) r.in_top50 = top50_set.has(r.sku);

  for (const r of rows) {
    const p = compute_priority(r);
    r.review_priority = p.priority;
    r.priority_reasons = p.reasons;
    r.recommended_action = recommend(r);
  }

  const groups = {
    active_total: rows.length,
    orderable: rows.filter((r) => r.sales_status === "orderable").length,
    showcase: rows.filter((r) => r.sales_status === "showcase").length,
    no_price: rows.filter((r) => r.price_amount == null).length,
    units_per_package_1: rows.filter((r) => r.units_eq_1).length,
    sku_unk: rows.filter((r) => r.sku_has_unk).length,
    package_unknown: rows.filter((r) => r.package_unknown).length,
    missing_brand: rows.filter((r) => r.missing_brand).length,
    missing_volume: rows.filter((r) => r.missing_volume).length,
    missing_image: rows.filter((r) => r.image_broken).length,
    external_image: rows.filter((r) => r.local_or_external === "external")
      .length,
    local_image: rows.filter((r) => r.local_or_external === "local").length,
    possible_duplicates: rows.filter((r) => r.possible_duplicate_count > 0)
      .length,
    similar_names: rows.filter((r) => r.similar_name_count > 0).length,
    with_interest: rows.filter((r) => r.interest_count > 0).length,
    high_priority: rows.filter((r) => r.review_priority === "high").length,
    medium_priority: rows.filter((r) => r.review_priority === "medium").length,
    low_priority: rows.filter((r) => r.review_priority === "low").length,
    ready_to_sell: rows.filter((r) => r.ready_to_sell).length,
  };

  const summary_sheet = [
    { Метрика: "Активных товаров", Значение: groups.active_total },
    { Метрика: "orderable", Значение: groups.orderable },
    { Метрика: "showcase", Значение: groups.showcase },
    { Метрика: "Без цены", Значение: groups.no_price },
    { Метрика: "units_per_package = 1", Значение: groups.units_per_package_1 },
    { Метрика: "SKU содержит UNK", Значение: groups.sku_unk },
    { Метрика: "package_type неизвестен", Значение: groups.package_unknown },
    { Метрика: "Нет бренда", Значение: groups.missing_brand },
    { Метрика: "Нет объёма", Значение: groups.missing_volume },
    { Метрика: "Нет изображения", Значение: groups.missing_image },
    { Метрика: "Внешнее изображение", Значение: groups.external_image },
    { Метрика: "Локальное изображение", Значение: groups.local_image },
    {
      Метрика: "Возможные дубли (товаров)",
      Значение: groups.possible_duplicates,
    },
    { Метрика: "Похожие названия (товаров)", Значение: groups.similar_names },
    { Метрика: "С interest-запросами", Значение: groups.with_interest },
    { Метрика: "Высокий приоритет", Значение: groups.high_priority },
    { Метрика: "Средний приоритет", Значение: groups.medium_priority },
    { Метрика: "Низкий приоритет", Значение: groups.low_priority },
    { Метрика: "Готовы к продаже", Значение: groups.ready_to_sell },
    { Метрика: "Top-50 для запуска", Значение: top50.length },
    {
      Метрика: "Примечание",
      Значение:
        "READ-ONLY аудит. Production / цены / image_url / заказы не изменялись.",
    },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary_sheet),
    "Сводка",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet_rows(rows.filter((r) => r.review_priority === "high")),
    ),
    "Высокий приоритет",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet_rows(rows.filter((r) => r.package_unknown || r.units_eq_1)),
    ),
    "Упаковка требует проверки",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet_rows(
        rows.filter(
          (r) => r.possible_duplicate_count > 0 || r.similar_name_count > 0,
        ),
      ),
    ),
    "Возможные дубли",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet_rows(rows.filter((r) => r.sku_has_unk))),
    "UNK SKU",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet_rows(rows.filter((r) => r.local_or_external === "external")),
    ),
    "Внешние изображения",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheet_rows(rows.filter((r) => r.interest_count > 0)),
    ),
    "Товары со спросом",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet_rows(rows.filter((r) => r.ready_to_sell))),
    "Готовы к продаже",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet_rows(rows)),
    "Полный каталог",
  );

  mkdirSync(ROOT, { recursive: true });
  XLSX.writeFile(wb, OUT_XLSX);

  const payload = {
    generated_at: new Date().toISOString(),
    note: "READ-ONLY catalog quality audit. No production / VPS / DB / price / image_url / order / client changes.",
    source_csv: csv_path,
    artifacts: {
      xlsx: OUT_XLSX,
      json: OUT_JSON,
      csv: csv_path,
    },
    groups,
    top50_for_sales_launch: top50.map((r) => ({
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      category: r.category_name,
      category_slug: r.category_slug,
      volume_text: r.volume_text,
      package_type: r.package_type,
      units_per_package: r.units_per_package,
      sales_status: r.sales_status,
      price_amount: r.price_amount,
      interest_count: r.interest_count,
      local_or_external: r.local_or_external,
      ready_to_sell: r.ready_to_sell,
      review_priority: r.review_priority,
      top50_score: r.top50_score,
      recommended_action: r.recommended_action,
    })),
    ready_to_sell_skus: rows.filter((r) => r.ready_to_sell).map((r) => r.sku),
    high_priority_skus: rows
      .filter((r) => r.review_priority === "high")
      .map((r) => r.sku),
    items: rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      category: r.category_name,
      category_slug: r.category_slug,
      volume_text: r.volume_text,
      volume_ml: r.volume_ml,
      package_type: r.package_type,
      units_per_package: r.units_per_package,
      sales_status: r.sales_status,
      price: r.price_amount,
      availability: r.availability,
      image_url: r.image_url,
      local_or_external: r.local_or_external,
      interest_count: r.interest_count,
      possible_duplicate_count: r.possible_duplicate_count,
      possible_duplicate_skus: r.possible_duplicate_skus,
      similar_name_skus: r.similar_name_skus,
      review_priority: r.review_priority,
      priority_reasons: r.priority_reasons,
      ready_to_sell: r.ready_to_sell,
      ready_blockers: r.ready_blockers,
      recommended_action: r.recommended_action,
      top50_score: r.top50_score,
      in_top50: r.in_top50,
    })),
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        groups,
        top50_count: top50.length,
        top50_sample: top50.slice(0, 20).map((r) => ({
          sku: r.sku,
          brand: r.brand,
          score: r.top50_score,
          interest: r.interest_count,
          ready: r.ready_to_sell,
        })),
        xlsx: OUT_XLSX,
        json: OUT_JSON,
      },
      null,
      2,
    ),
  );
}

main();
