import type { TindaProductImageTarget } from "@/lib/catalog/external-images/types";

export type ReplacementPriority = {
  priority: number; // lower = replace sooner
  reason: string;
};

/**
 * Suggest replacement order.
 * 1 no photo, 2 broken, 3 low quality, 4 external CDN, 5 official found
 * Do not replace good owned images with worse candidates (caller enforces).
 */
export function replacement_priority_for_product(
  product: TindaProductImageTarget,
  options?: {
    current_image_ok?: boolean | null;
    current_low_quality?: boolean | null;
    candidate_source_priority?: number | null; // 1 official .. 4 other
    candidate_ok?: boolean;
  },
): ReplacementPriority {
  const url = (product.image_url || "").trim();
  if (!url) {
    return { priority: 1, reason: "no_photo" };
  }
  if (options?.current_image_ok === false) {
    return { priority: 2, reason: "current_broken" };
  }
  if (options?.current_low_quality) {
    return { priority: 3, reason: "current_low_quality" };
  }
  const is_external_cdn =
    /^https?:\/\//i.test(url) && !url.includes("/uploads/products/");
  if (is_external_cdn) {
    return { priority: 4, reason: "external_cdn" };
  }
  if ((options?.candidate_source_priority ?? 99) === 1 && options?.candidate_ok) {
    return { priority: 5, reason: "official_available" };
  }
  return { priority: 90, reason: "keep_current_unless_better" };
}

export function should_auto_prepare_replacement(
  match_status: string,
  image_ok: boolean,
  has_watermark: boolean | null,
): boolean {
  if (match_status !== "exact_match") return false;
  if (!image_ok) return false;
  if (has_watermark === true) return false;
  return true;
}
