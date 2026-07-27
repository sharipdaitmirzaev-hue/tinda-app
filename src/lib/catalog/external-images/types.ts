export const MATCH_STATUSES = [
  "exact_match",
  "probable_match",
  "no_match",
  "conflict",
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const REVIEW_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "needs_review",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type TindaProductImageTarget = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  flavor?: string | null;
  image_url: string | null;
  is_active?: boolean;
  sales_status?: string;
};

export type ExternalImageCandidate = {
  source_site: string;
  source_product_url: string;
  candidate_image_url: string;
  source_name: string;
  source_brand?: string | null;
  source_volume?: string | null;
  source_package?: string | null;
  source_flavor?: string | null;
  source_sku?: string | null;
  source_priority?: number; // 1=official brand, 2=distributor, 3=retail, 4=other
};

export type ImageProbeResult = {
  ok: boolean;
  url: string;
  http_status: number | null;
  mime: string | null;
  format: "jpeg" | "png" | "webp" | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  has_watermark: boolean | null; // null = unknown / needs human review
  low_quality: boolean;
  placeholder_like: boolean;
  background_hint: "white" | "transparent" | "other" | "unknown";
  reasons: string[];
};

export type MatchResult = {
  tinda: TindaProductImageTarget;
  candidate: ExternalImageCandidate;
  match_status: MatchStatus;
  match_score: number;
  reasons: string[];
};

export type ReviewRow = {
  tinda_product_id: string;
  tinda_sku: string;
  tinda_name: string;
  tinda_brand: string;
  tinda_volume: string;
  current_image_url: string;
  source_site: string;
  source_product_url: string;
  candidate_image_url: string;
  source_name: string;
  match_status: MatchStatus;
  match_score: number;
  image_width: number | null;
  image_height: number | null;
  image_format: string;
  has_watermark: string;
  review_status: ReviewStatus;
  review_comment: string;
  replacement_priority?: number;
  source_priority?: number;
};
