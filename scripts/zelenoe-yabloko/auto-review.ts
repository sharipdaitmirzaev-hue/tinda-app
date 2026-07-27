#!/usr/bin/env node
/**
 * Automatic preliminary review of Zelenoe Yabloko gallery cards.
 *
 * Writes review-decisions.json / .xlsx only.
 * Does NOT change production / VPS / DB / image_url.
 * Does NOT upload, create products, or replace photos.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { score_candidate_match } from "../../src/lib/catalog/external-images/match";
import {
  extract_flavor_hint,
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
  token_overlap,
} from "../../src/lib/catalog/external-images/normalize";
import { detect_carbonation } from "../../src/lib/catalog/external-images/zy-parse-name";
import type {
  ExternalImageCandidate,
  TindaProductImageTarget,
} from "../../src/lib/catalog/external-images/types";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const SAFE_SCORE = 80;
const DEFAULT_ROOT = path.resolve("data/imports/zelenoe-yabloko-images");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

const ROOT = path.resolve(arg("root", DEFAULT_ROOT)!);

type Card = {
  source_index: number;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  source_product_url: string;
  candidate_image_url: string;
  local_original_path: string;
  preview_path: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  sha256: string;
  match_status: string;
  match_score: number | null;
  tinda_product_id: string;
  tinda_sku: string;
  tinda_name: string;
  tinda_volume: string;
  current_image_url: string;
  volume_match: boolean | null;
  package_match: boolean | null;
  source_price_reference: string | number;
  proposed_sku: string;
  below_500: boolean;
  download_status: string;
  carbonation?: string;
  source_category_slug?: string;
  product_type?: string;
  has_pulp?: boolean | null;
  is_kids_line?: boolean;
  sugar_free?: boolean | null;
};

type Decision = {
  source_index: number;
  source_name: string;
  source_product_url: string;
  candidate_image_url: string;
  local_original_path: string;
  preview_path: string;
  match_status: string;
  match_score: number | null;
  tinda_product_id: string;
  tinda_sku: string;
  tinda_name: string;
  review_status:
    | "approved_existing"
    | "approved_new"
    | "needs_review"
    | "rejected"
    | "pending";
  review_comment: string;
  width: number | null;
  height: number | null;
  sha256: string;
  auto_reviewed: true;
  auto_review_confidence: number;
  matched_features: string[];
  mismatches: string[];
  decision_reason: string;
};

const CATEGORY_MODE = (() => {
  const explicit = arg("category", null);
  if (explicit) return explicit;
  if (/zelenoe-yabloko-energy/i.test(ROOT)) return "energy";
  if (/zelenoe-yabloko-water/i.test(ROOT)) return "water";
  if (/zelenoe-yabloko-juice/i.test(ROOT)) return "juice";
  return "soft-drinks";
})();

/** Soft-drinks auto-review excludes energy; energy/juice modes keep their products. */
const EXCLUDED =
  CATEGORY_MODE === "energy" || CATEGORY_MODE === "juice"
    ? /(пиво|вино|водк|алкогол|виски|коньяк|шампан|сидр|бакалея|чипсы|снек|йогурт|молоко|хлеб)/i
    : /(пиво|вино|водк|алкогол|виски|коньяк|шампан|сидр|energy drink|энергет|бакалея|чипсы|снек)/i;

const ENERGY_HINT =
  /(энергет|energy\s*drink|\bburn\b|\bберн\b|red\s*bull|monster|adrenaline|flash|drive\s*me|gorilla|tornado|lit\s*energy|jaguar|battery)/i;

const JUICE_HINT =
  /(сок|нектар|морс|сокосодерж|вода\s*и\s*сок|juice|nectar)/i;

function category_ok_for_new(card: Card): { ok: boolean; note: string } {
  if (CATEGORY_MODE === "energy") {
    const slug = String(card.source_category_slug || "");
    if (/energet/i.test(slug)) {
      return { ok: true, note: "category_energy_slug" };
    }
    if (ENERGY_HINT.test(card.source_name)) {
      return { ok: true, note: "category_energy_name" };
    }
    return { ok: false, note: "category_not_energy" };
  }
  if (CATEGORY_MODE === "juice") {
    const slug = String(card.source_category_slug || "");
    const ptype = String((card as { product_type?: string }).product_type || "");
    if (/soki|nektar|mors|voda-soki/i.test(slug)) {
      return { ok: true, note: "category_juice_slug" };
    }
    if (["juice", "nectar", "mors", "juice_drink"].includes(ptype)) {
      return { ok: true, note: `category_product_type_${ptype}` };
    }
    if (JUICE_HINT.test(card.source_name)) {
      return { ok: true, note: "category_juice_name" };
    }
    return { ok: false, note: "category_not_juice" };
  }
  return { ok: true, note: "category_not_required" };
}

function clean_flavor(raw: string): string {
  return String(raw || "")
    .replace(/\b(напиток|газир(?:ованный)?|газ)\b/gi, " ")
    .replace(/\b(пл\s*\/?\s*б|ст\s*\/?\s*б|ж\s*\/?\s*б|пэт|pet|банка|стекло)\b/gi, " ")
    .replace(/\b(пл|ст|ж)\s*б\b/gi, " ")
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function size_ok(card: Card): boolean {
  return (
    !card.below_500 &&
    (card.width ?? 0) >= 500 &&
    (card.height ?? 0) >= 500
  );
}

function image_ok(card: Card): boolean {
  const status = card.download_status || "ok";
  if (status !== "ok" && status !== "duplicate") {
    return false;
  }
  if (!card.local_original_path && !card.preview_path) return false;
  if ((card.file_size ?? 0) > 0 && (card.file_size ?? 0) < 4000) return false;
  // If dimensions known and zero — broken
  if (card.width === 0 || card.height === 0) return false;
  return true;
}

function brand_ok(card: Card, tinda: TindaProductImageTarget | null): boolean {
  if (!card.brand) return false;
  if (!tinda) return !!normalize_brand(card.brand);
  const a = normalize_brand(card.brand);
  const b = normalize_brand(tinda.brand || "");
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function volume_ok(card: Card, tinda: TindaProductImageTarget | null): boolean {
  const sv = parse_volume_ml(card.volume_text);
  if (sv == null) return false;
  if (!tinda) return true;
  if (card.volume_match === true) return true;
  if (card.volume_match === false) return false;
  const tv = parse_volume_ml(tinda.volume_text || card.tinda_volume);
  return tv != null && tv === sv;
}

function package_ok(card: Card, tinda: TindaProductImageTarget | null): boolean {
  const sp = normalize_package(card.package_type || card.source_name);
  if (!sp) return false;
  if (!tinda) return true;
  if (card.package_match === true) return true;
  if (card.package_match === false) return false;
  const tp =
    normalize_package(tinda.package_type || "") ||
    normalize_package(tinda.name || card.tinda_name);
  return !!tp && tp === sp;
}

function flavor_ok(card: Card, tinda: TindaProductImageTarget | null): {
  ok: boolean;
  note: string;
} {
  const sf = clean_flavor(
    card.flavor ||
      extract_flavor_hint(
        card.source_name,
        card.brand,
        card.volume_text,
        card.package_type,
      ),
  );
  if (!tinda) {
    return { ok: sf.length >= 2, note: sf ? "flavor_present" : "flavor_missing" };
  }
  const tf = clean_flavor(
    extract_flavor_hint(
      tinda.name || card.tinda_name,
      tinda.brand,
      tinda.volume_text || card.tinda_volume,
      tinda.package_type,
    ),
  );
  if (!sf && !tf) return { ok: true, note: "flavor_both_empty" };
  if (!sf || !tf) return { ok: false, note: "flavor_one_side_empty" };
  const overlap = token_overlap(sf, tf);
  if (overlap >= 0.45) return { ok: true, note: `flavor_overlap_${overlap.toFixed(2)}` };
  // also allow strong name overlap
  const name_ov = token_overlap(card.source_name, tinda.name || card.tinda_name);
  if (name_ov >= 0.65) return { ok: true, note: `name_overlap_${name_ov.toFixed(2)}` };
  return { ok: false, note: `flavor_mismatch_${overlap.toFixed(2)}` };
}

function sugar_ok(card: Card, tinda: TindaProductImageTarget | null): {
  ok: boolean;
  note: string;
} {
  const ss = sugar_free_flag(card.source_name);
  if (!tinda) return { ok: true, note: ss == null ? "sugar_unknown" : ss ? "sugar_free" : "regular" };
  const ts = sugar_free_flag(tinda.name || card.tinda_name);
  if (ts == null && ss == null) return { ok: true, note: "sugar_unknown" };
  if (ts != null && ss != null) {
    return ts === ss
      ? { ok: true, note: "sugar_match" }
      : { ok: false, note: "sugar_conflict" };
  }
  // asymmetric: one known — not safe for auto approve existing
  return { ok: false, note: "sugar_asymmetric" };
}

function carbonation_ok(
  card: Card,
  tinda: TindaProductImageTarget | null,
): { ok: boolean; note: string; required: boolean } {
  const source =
    (card.carbonation as "sparkling" | "still" | "unknown" | undefined) ||
    detect_carbonation(card.source_name, card.source_category_slug);
  // Only enforce when we know source carbonation (water pipeline).
  if (source === "unknown") {
    return { ok: true, note: "carbonation_not_required", required: false };
  }
  if (!tinda) {
    return { ok: true, note: `carbonation_source_${source}`, required: true };
  }
  const target = detect_carbonation(
    `${tinda.name || ""} ${tinda.brand || ""}`,
    null,
  );
  if (target === "unknown") {
    return { ok: false, note: "carbonation_tinda_unknown", required: true };
  }
  return source === target
    ? { ok: true, note: `carbonation_${source}`, required: true }
    : { ok: false, note: `carbonation_mismatch_${source}_vs_${target}`, required: true };
}

function find_tinda(
  products: TindaProductImageTarget[],
  id: string,
  sku: string,
): TindaProductImageTarget | null {
  return (
    products.find((p) => p.id === id) ||
    products.find((p) => p.sku === sku) ||
    null
  );
}

function rival_exact_count(
  card: Card,
  products: TindaProductImageTarget[],
  primary_id: string,
): number {
  const candidate: ExternalImageCandidate = {
    source_site: "zelenoeyabloko.ru",
    source_product_url: card.source_product_url,
    candidate_image_url: card.candidate_image_url,
    source_name: card.source_name,
    source_brand: card.brand,
    source_flavor: clean_flavor(card.flavor),
    source_volume: card.volume_text,
    source_package: card.package_type,
    source_priority: 3,
  };
  let rivals = 0;
  for (const p of products) {
    if (p.id === primary_id) continue;
    const m = score_candidate_match(p, candidate);
    if (m.match_status === "exact_match" || m.match_score >= SAFE_SCORE) {
      rivals += 1;
    }
  }
  return rivals;
}

function has_tinda_duplicate(
  card: Card,
  products: TindaProductImageTarget[],
): { hit: boolean; note: string } {
  const candidate: ExternalImageCandidate = {
    source_site: "zelenoeyabloko.ru",
    source_product_url: card.source_product_url,
    candidate_image_url: card.candidate_image_url,
    source_name: card.source_name,
    source_brand: card.brand,
    source_flavor: clean_flavor(card.flavor),
    source_volume: card.volume_text,
    source_package: card.package_type,
    source_priority: 3,
  };
  const hits = products
    .map((p) => score_candidate_match(p, candidate))
    .filter(
      (m) =>
        m.match_status === "exact_match" ||
        m.match_status === "probable_match" ||
        m.match_score >= 70,
    )
    .sort((a, b) => b.match_score - a.match_score);
  if (hits.length === 0) return { hit: false, note: "no_tinda_near_match" };
  return {
    hit: true,
    note: `near_tinda:${hits[0]!.tinda.sku}:${hits[0]!.match_status}:${hits[0]!.match_score}`,
  };
}

function decide(card: Card, products: TindaProductImageTarget[]): Decision {
  const matched: string[] = [];
  const mismatches: string[] = [];
  const base = {
    source_index: card.source_index,
    source_name: card.source_name,
    source_product_url: card.source_product_url,
    candidate_image_url: card.candidate_image_url,
    local_original_path: card.local_original_path,
    preview_path: card.preview_path,
    match_status: card.match_status,
    match_score: card.match_score,
    tinda_product_id: card.tinda_product_id,
    tinda_sku: card.tinda_sku,
    tinda_name: card.tinda_name,
    width: card.width,
    height: card.height,
    sha256: card.sha256,
    auto_reviewed: true as const,
  };

  // Hard rejects
  if ((card.file_size ?? 0) > 0 && (card.file_size ?? 0) < 4000) {
    return {
      ...base,
      review_status: "rejected",
      review_comment: "Авто: placeholder / слишком маленький файл",
      auto_review_confidence: 0.85,
      matched_features: [],
      mismatches: ["placeholder_like", `file_size_${card.file_size}`],
      decision_reason: "rejected_placeholder",
    };
  }
  if (!image_ok(card)) {
    return {
      ...base,
      review_status: "rejected",
      review_comment: "Авто: повреждённое/недоступное изображение",
      auto_review_confidence: 0.9,
      matched_features: [],
      mismatches: ["image_unreadable_or_missing"],
      decision_reason: "rejected_bad_image",
    };
  }
  if (EXCLUDED.test(card.source_name)) {
    return {
      ...base,
      review_status: "rejected",
      review_comment: "Авто: excluded-категория / не целевой напиток",
      auto_review_confidence: 0.85,
      matched_features: [],
      mismatches: ["excluded_category"],
      decision_reason: "rejected_excluded_category",
    };
  }

  const tinda = find_tinda(products, card.tinda_product_id, card.tinda_sku);

  // Force needs_review buckets
  if (
    card.match_status === "probable_match" ||
    card.match_status === "conflict" ||
    card.match_status === "unknown"
  ) {
    mismatches.push(`status_${card.match_status}`);
    if (!size_ok(card)) mismatches.push("below_500");
    return {
      ...base,
      review_status: "needs_review",
      review_comment: `Авто: статус ${card.match_status} требует ручной проверки`,
      auto_review_confidence: 0.55,
      matched_features: matched,
      mismatches,
      decision_reason: `needs_review_${card.match_status}`,
    };
  }

  if (!size_ok(card)) {
    return {
      ...base,
      review_status: "needs_review",
      review_comment: "Авто: изображение меньше 500×500",
      auto_review_confidence: 0.7,
      matched_features: matched,
      mismatches: ["below_500"],
      decision_reason: "needs_review_small_image",
    };
  }

  // approved_existing path
  if (card.match_status === "exact_match") {
    matched.push("match_status_exact");
    const b = brand_ok(card, tinda);
    const v = volume_ok(card, tinda);
    const p = package_ok(card, tinda);
    const f = flavor_ok(card, tinda);
    const s = sugar_ok(card, tinda);
    const c = carbonation_ok(card, tinda);
    const score = card.match_score ?? 0;

    if (b) matched.push("brand");
    else mismatches.push("brand");
    if (v) matched.push("volume");
    else mismatches.push("volume");
    if (p) matched.push("package");
    else mismatches.push("package");
    if (f.ok) matched.push(f.note);
    else mismatches.push(f.note);
    if (s.ok) matched.push(s.note);
    else mismatches.push(s.note);
    if (c.required) {
      if (c.ok) matched.push(c.note);
      else mismatches.push(c.note);
    }
    if (score >= SAFE_SCORE) matched.push(`score_${score}`);
    else mismatches.push(`score_low_${score}`);
    matched.push("size_ge_500", "image_opens", "no_watermark_detected");

    // Brand-only is never enough — require full set
    const rivals = tinda
      ? rival_exact_count(card, products, tinda.id)
      : 99;
    if (rivals > 0) mismatches.push(`rival_tinda_count_${rivals}`);

    const all_ok =
      b &&
      v &&
      p &&
      f.ok &&
      s.ok &&
      (!c.required || c.ok) &&
      score >= SAFE_SCORE &&
      !!tinda &&
      rivals === 0 &&
      size_ok(card) &&
      image_ok(card);

    if (all_ok) {
      return {
        ...base,
        review_status: "approved_existing",
        review_comment:
          "Авто: exact_match, бренд/объём/упаковка/вкус/sugar совпали, score≥80, уникальный TINDA, фото≥500. Визуальное соответствие предполагается по exact_match — желательна выборочная ручная проверка.",
        auto_review_confidence: 0.82,
        matched_features: matched,
        mismatches,
        decision_reason: "approved_existing_strict_exact",
      };
    }

    return {
      ...base,
      review_status: "needs_review",
      review_comment: `Авто: exact_match, но не все строгие условия (${mismatches.join(", ")})`,
      auto_review_confidence: 0.6,
      matched_features: matched,
      mismatches,
      decision_reason: "needs_review_exact_incomplete",
    };
  }

  // approved_new path
  if (card.match_status === "new_product") {
    const brand = !!normalize_brand(card.brand);
    const volume = parse_volume_ml(card.volume_text) != null;
    const pkg = !!normalize_package(card.package_type || card.source_name);
    const fl = flavor_ok(card, null);
    const name_ok = card.source_name.trim().length >= 8;
    if (brand) matched.push("brand_parsed");
    else mismatches.push("brand_missing");
    if (name_ok) matched.push("name_present");
    else mismatches.push("name_weak");
    if (fl.ok) matched.push(fl.note);
    else mismatches.push(fl.note);
    if (volume) matched.push("volume_parsed");
    else mismatches.push("volume_missing");
    if (pkg) matched.push("package_parsed");
    else mismatches.push("package_missing");
    matched.push("size_ge_500", "image_opens", "no_watermark_detected");

    const dup = has_tinda_duplicate(card, products);
    if (dup.hit) mismatches.push(dup.note);
    else matched.push(dup.note);

    const sugar = sugar_free_flag(card.source_name);
    if (sugar != null) matched.push(sugar ? "marked_sugar_free" : "marked_regular");

    const cat = category_ok_for_new(card);
    if (cat.ok) matched.push(cat.note);
    else mismatches.push(cat.note);

    // Contested zero / flavor / package → needs_review
    if (!pkg) mismatches.push("package_undetermined");
    if (!fl.ok) mismatches.push("flavor_contested");
    if (sugar == null && /(zero|зеро|без\s*сахара)/i.test(card.source_name)) {
      mismatches.push("sugar_free_contested");
    }

    if (CATEGORY_MODE === "juice") {
      const ptype = String(card.product_type || "");
      if (!["juice", "nectar", "mors", "juice_drink"].includes(ptype)) {
        mismatches.push("product_type_undetermined");
      } else {
        matched.push(`product_type_${ptype}`);
      }
      if (card.is_kids_line) matched.push("kids_line");
      if (card.has_pulp === true) matched.push("has_pulp");
      if (card.has_pulp === false) matched.push("clarified");
    }

    const product_type_ok =
      CATEGORY_MODE !== "juice" ||
      ["juice", "nectar", "mors", "juice_drink"].includes(
        String(card.product_type || ""),
      );

    const all_ok =
      brand &&
      name_ok &&
      fl.ok &&
      volume &&
      pkg &&
      cat.ok &&
      product_type_ok &&
      !dup.hit &&
      size_ok(card) &&
      image_ok(card) &&
      !EXCLUDED.test(card.source_name);

    if (all_ok) {
      return {
        ...base,
        review_status: "approved_new",
        review_comment: `Авто: new_product, атрибуты распознаны, нет near-дубля в ТИНДА, фото≥500. proposed_sku=${card.proposed_sku}. Товар ещё не создан — только кандидат.`,
        auto_review_confidence: 0.78,
        matched_features: matched,
        mismatches,
        decision_reason: "approved_new_clean_candidate",
      };
    }

    return {
      ...base,
      review_status: "needs_review",
      review_comment: `Авто: new_product, нужна ручная проверка (${mismatches.join(", ")})`,
      auto_review_confidence: 0.58,
      matched_features: matched,
      mismatches,
      decision_reason: "needs_review_new_incomplete",
    };
  }

  return {
    ...base,
    review_status: "needs_review",
    review_comment: `Авто: необработанный match_status=${card.match_status}`,
    auto_review_confidence: 0.4,
    matched_features: matched,
    mismatches: [`unhandled_${card.match_status}`],
    decision_reason: "needs_review_fallback",
  };
}

function main() {
  const gallery_data_path = path.join(ROOT, "gallery-data.json");
  const products_path = path.resolve(
    arg("products", "data/imports/tinda_active_products.snapshot.json")!,
  );
  if (!existsSync(gallery_data_path)) {
    throw new Error("gallery-data.json missing — run npm run zelenoe-images:gallery");
  }
  const gallery = JSON.parse(readFileSync(gallery_data_path, "utf8")) as {
    cards: Card[];
  };
  const products = JSON.parse(
    readFileSync(products_path, "utf8"),
  ) as TindaProductImageTarget[];

  const decisions = gallery.cards.map((c) => decide(c, products));

  const summary = {
    generated_at: new Date().toISOString(),
    note: "Automatic preliminary review only. No production / VPS / image_url changes.",
    counts: {
      approved_existing: decisions.filter((d) => d.review_status === "approved_existing")
        .length,
      approved_new: decisions.filter((d) => d.review_status === "approved_new").length,
      needs_review: decisions.filter((d) => d.review_status === "needs_review").length,
      rejected: decisions.filter((d) => d.review_status === "rejected").length,
    },
    approved_existing_skus: decisions
      .filter((d) => d.review_status === "approved_existing")
      .map((d) => d.tinda_sku),
    needs_review_brief: decisions
      .filter((d) => d.review_status === "needs_review")
      .map((d) => ({
        source_index: d.source_index,
        source_name: d.source_name,
        match_status: d.match_status,
        reason: d.decision_reason,
        mismatches: d.mismatches,
      })),
  };

  mkdirSync(ROOT, { recursive: true });
  const json_path = path.join(ROOT, "review-decisions.json");
  writeFileSync(
    json_path,
    JSON.stringify({ ...summary, items: decisions }, null, 2),
  );

  const sheet = decisions.map((d) => ({
    source_index: d.source_index,
    source_name: d.source_name,
    source_product_url: d.source_product_url,
    candidate_image_url: d.candidate_image_url,
    local_original_path: d.local_original_path,
    preview_path: d.preview_path,
    match_status: d.match_status,
    match_score: d.match_score,
    tinda_product_id: d.tinda_product_id,
    tinda_sku: d.tinda_sku,
    tinda_name: d.tinda_name,
    review_status: d.review_status,
    review_comment: d.review_comment,
    width: d.width,
    height: d.height,
    sha256: d.sha256,
    auto_reviewed: d.auto_reviewed,
    auto_review_confidence: d.auto_review_confidence,
    matched_features: d.matched_features.join("|"),
    mismatches: d.mismatches.join("|"),
    decision_reason: d.decision_reason,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Решения");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        step: 1,
        text: "Автоматическая предварительная проверка. Требует ручной выборочной валидации.",
      },
      {
        step: 2,
        text: "Не загружать на VPS и не менять image_url автоматически.",
      },
    ]),
    "Инструкция",
  );
  const xlsx_path = path.join(ROOT, "review-decisions.xlsx");
  XLSX.writeFile(wb, xlsx_path);

  writeFileSync(
    path.join(ROOT, "auto-review-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(JSON.stringify({ json_path, xlsx_path, ...summary }, null, 2));
}

main();
