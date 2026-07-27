import {
  extract_flavor_hint,
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
  token_overlap,
  lower,
} from "@/lib/catalog/external-images/normalize";
import type {
  ExternalImageCandidate,
  MatchResult,
  MatchStatus,
  TindaProductImageTarget,
} from "@/lib/catalog/external-images/types";

function brand_score(
  tinda_brand: string | null,
  source_brand: string | null | undefined,
  source_name: string,
): { score: number; ok: boolean; reason: string } {
  const tb = normalize_brand(tinda_brand);
  if (!tb) return { score: 0, ok: false, reason: "tinda_brand_empty" };
  const sb = normalize_brand(source_brand || "");
  if (sb && (sb === tb || sb.includes(tb) || tb.includes(sb))) {
    return { score: 30, ok: true, reason: "brand_exact" };
  }
  const in_name = normalize_brand(source_name);
  if (in_name.includes(tb)) {
    return { score: 22, ok: true, reason: "brand_in_source_name" };
  }
  return { score: 0, ok: false, reason: "brand_mismatch" };
}

function volume_score(
  tinda_volume: string | null,
  source_volume: string | null | undefined,
  source_name: string,
): { score: number; ok: boolean; reason: string } {
  const tv = parse_volume_ml(tinda_volume);
  if (tv == null) return { score: 0, ok: false, reason: "tinda_volume_missing" };
  const sv =
    parse_volume_ml(source_volume) ?? parse_volume_ml(source_name);
  if (sv == null) return { score: 0, ok: false, reason: "source_volume_missing" };
  if (sv === tv) return { score: 25, ok: true, reason: "volume_exact" };
  // tolerate 1% rounding
  if (Math.abs(sv - tv) <= Math.max(5, tv * 0.01)) {
    return { score: 20, ok: true, reason: "volume_near" };
  }
  return { score: 0, ok: false, reason: "volume_mismatch" };
}

function package_score(
  tinda_package: string | null,
  source_package: string | null | undefined,
  source_name: string,
): { score: number; ok: boolean; reason: string } {
  const tp = normalize_package(tinda_package);
  if (!tp) return { score: 0, ok: false, reason: "tinda_package_missing" };
  const sp =
    normalize_package(source_package) || normalize_package(source_name);
  if (!sp) return { score: 0, ok: false, reason: "source_package_missing" };
  if (sp === tp) return { score: 20, ok: true, reason: "package_exact" };
  return { score: 0, ok: false, reason: "package_mismatch" };
}

function sugar_score(tinda_name: string, source_name: string): {
  score: number;
  ok: boolean;
  reason: string;
} {
  const ts = sugar_free_flag(tinda_name);
  const ss = sugar_free_flag(source_name);
  if (ts == null && ss == null) {
    return { score: 0, ok: true, reason: "sugar_unknown" };
  }
  if (ts != null && ss != null) {
    if (ts === ss) return { score: 10, ok: true, reason: "sugar_match" };
    return { score: -25, ok: false, reason: "sugar_conflict" };
  }
  // One side known sugar-free, other unknown — allow probable, block exact
  return { score: 0, ok: true, reason: "sugar_asymmetric" };
}

/**
 * Score one TINDA product against one external candidate.
 * Does not assign conflict — caller aggregates per product.
 */
export function score_candidate_match(
  tinda: TindaProductImageTarget,
  candidate: ExternalImageCandidate,
): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  if (
    candidate.source_sku &&
    lower(candidate.source_sku) === lower(tinda.sku)
  ) {
    return {
      tinda,
      candidate,
      match_status: "exact_match",
      match_score: 100,
      reasons: ["sku_exact"],
    };
  }

  const brand = brand_score(tinda.brand, candidate.source_brand, candidate.source_name);
  reasons.push(brand.reason);
  score += brand.score;

  const volume = volume_score(
    tinda.volume_text,
    candidate.source_volume,
    candidate.source_name,
  );
  reasons.push(volume.reason);
  score += volume.score;

  const pkg = package_score(
    tinda.package_type,
    candidate.source_package,
    candidate.source_name,
  );
  reasons.push(pkg.reason);
  score += pkg.score;

  const sugar = sugar_score(tinda.name, candidate.source_name);
  reasons.push(sugar.reason);
  score += sugar.score;

  const tinda_flavor =
    tinda.flavor ||
    extract_flavor_hint(
      tinda.name,
      tinda.brand,
      tinda.volume_text,
      tinda.package_type,
    );
  const source_flavor =
    candidate.source_flavor ||
    extract_flavor_hint(
      candidate.source_name,
      candidate.source_brand || tinda.brand,
      candidate.source_volume || tinda.volume_text,
      candidate.source_package || tinda.package_type,
    );
  const flavor_overlap = token_overlap(tinda_flavor, source_flavor);
  const name_overlap = token_overlap(tinda.name, candidate.source_name);
  const best_overlap = Math.max(flavor_overlap, name_overlap);
  if (best_overlap >= 0.75) {
    score += 15;
    reasons.push("name_flavor_strong");
  } else if (best_overlap >= 0.45) {
    score += 8;
    reasons.push("name_flavor_partial");
  } else {
    reasons.push("name_flavor_weak");
  }

  // Exact match requires brand + volume + package + compatible sugar + flavor
  const flavor_ok =
    flavor_overlap >= 0.5 ||
    (best_overlap >= 0.65 && reasons.includes("name_flavor_strong")) ||
    (flavor_overlap >= 0.35 && name_overlap >= 0.7);
  const sugar_exact_ok =
    sugar.reason === "sugar_match" || sugar.reason === "sugar_unknown";

  let match_status: MatchStatus = "no_match";
  const core_ok = brand.ok && volume.ok && pkg.ok && sugar.ok;
  if (!sugar.ok) {
    match_status = "no_match";
  } else if (core_ok && flavor_ok && sugar_exact_ok && score >= 80) {
    match_status = "exact_match";
    reasons.push("flavor_aligned");
  } else if (
    brand.ok &&
    volume.ok &&
    sugar.ok &&
    best_overlap >= 0.35 &&
    score >= 55
  ) {
    match_status = "probable_match";
  } else if (brand.ok && best_overlap >= 0.45 && score >= 40) {
    match_status = "probable_match";
  } else {
    match_status = "no_match";
  }

  // Hard reject on volume+package double mismatch
  if (reasons.includes("volume_mismatch") && reasons.includes("package_mismatch")) {
    match_status = "no_match";
  }
  if (
    match_status === "exact_match" &&
    (!brand.ok || !volume.ok || !pkg.ok || !sugar.ok || !flavor_ok || !sugar_exact_ok)
  ) {
    match_status = "probable_match";
    reasons.push("exact_demoted");
  }

  return {
    tinda,
    candidate,
    match_status,
    match_score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
  };
}

export type ProductMatchAggregate = {
  tinda: TindaProductImageTarget;
  best: MatchResult | null;
  matches: MatchResult[];
  final_status: MatchStatus;
};

/**
 * For one TINDA product, pick best candidate and detect conflicts.
 */
export function aggregate_product_matches(
  tinda: TindaProductImageTarget,
  candidates: ExternalImageCandidate[],
): ProductMatchAggregate {
  const matches = candidates
    .map((c) => score_candidate_match(tinda, c))
    .filter((m) => m.match_status !== "no_match")
    .sort((a, b) => b.match_score - a.match_score);

  if (matches.length === 0) {
    return { tinda, best: null, matches: [], final_status: "no_match" };
  }

  const exact = matches.filter((m) => m.match_status === "exact_match");
  if (exact.length > 1) {
    // Multiple exact candidates for one product
    const urls = new Set(exact.map((m) => m.candidate.candidate_image_url));
    if (urls.size > 1) {
      return {
        tinda,
        best: exact[0] ?? null,
        matches: exact,
        final_status: "conflict",
      };
    }
  }

  const best = matches[0]!;
  // Ambiguous top-2 probable/exact with close scores
  if (
    matches.length >= 2 &&
    matches[1] &&
    best.match_score - matches[1].match_score <= 5 &&
    best.match_score >= 70
  ) {
    return { tinda, best, matches: matches.slice(0, 3), final_status: "conflict" };
  }

  return {
    tinda,
    best,
    matches: matches.slice(0, 5),
    final_status: best.match_status,
  };
}

/**
 * Detect candidates that strongly match multiple TINDA products.
 * Only exact hits count — weak probable matches must not create conflicts.
 */
export function detect_candidate_conflicts(
  aggregates: ProductMatchAggregate[],
): Map<string, string[]> {
  const by_url = new Map<string, string[]>();
  for (const agg of aggregates) {
    for (const m of agg.matches) {
      if (m.match_status !== "exact_match") continue;
      if (m.match_score < 80) continue;
      const url = m.candidate.candidate_image_url;
      const list = by_url.get(url) || [];
      list.push(agg.tinda.sku);
      by_url.set(url, list);
    }
  }
  const conflicts = new Map<string, string[]>();
  for (const [url, skus] of by_url) {
    const unique = [...new Set(skus)];
    if (unique.length > 1) conflicts.set(url, unique);
  }
  return conflicts;
}
