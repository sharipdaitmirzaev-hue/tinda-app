import type { AquAlaniaProduct, ImageMatchStatus, ReviewStatus } from "./types";

export function review_product(p: AquAlaniaProduct): {
  review_status: ReviewStatus;
  review_reason: string;
  confidence: AquAlaniaProduct["confidence"];
} {
  const reasons: string[] = [];

  if (p.duplicate_status === "sku_collision" || p.duplicate_status === "conflict") {
    reasons.push(p.duplicate_status);
  }
  if (p.duplicate_status === "probable_match") reasons.push("probable_match");
  if (p.category_status === "manual") reasons.push("category_manual");
  if (p.image_match_status === "missing") reasons.push("missing_image");
  if (!p.flavor?.trim()) reasons.push("unclear_flavor");
  if (!p.volume_ml || !p.package_code) reasons.push("incomplete_packaging");
  if (p.image_match_status === "shared") reasons.push("shared_image");

  // Image mismatch heuristics (wrong package family)
  if (p.image_match_status === "missing" && !p.source_image_url) {
    return {
      review_status: "rejected",
      review_reason: reasons.join("; ") || "missing_image",
      confidence: "low",
    };
  }

  const approved =
    reasons.length === 0 &&
    p.brand === "AquAlania" &&
    Boolean(p.flavor) &&
    Boolean(p.volume_ml) &&
    Boolean(p.package_code) &&
    p.category_status === "mapped" &&
    p.duplicate_status === "new_product" &&
    (p.image_match_status === "exact" || p.image_match_status === "exact_low_res");

  if (approved) {
    return {
      review_status: "approved",
      review_reason: "",
      confidence: p.image_match_status === "exact" ? "high" : "medium",
    };
  }

  if (reasons.includes("missing_image") && !p.source_image_url) {
    return { review_status: "rejected", review_reason: reasons.join("; "), confidence: "low" };
  }

  return {
    review_status: "manual",
    review_reason: reasons.join("; ") || "needs_manual_review",
    confidence: "medium",
  };
}

export function image_mismatch_excluded(status: ImageMatchStatus | "mismatch"): boolean {
  return status === "mismatch" || status === "missing";
}

/** Manifest may contain only approved rows. */
export function filter_manifest_products<T extends { review_status: ReviewStatus }>(
  products: T[],
): T[] {
  return products.filter((p) => p.review_status === "approved");
}
