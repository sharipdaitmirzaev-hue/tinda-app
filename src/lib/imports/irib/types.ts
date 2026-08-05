export type IribPackageCode = "GLASS" | "PET" | "CAN";

export type ReviewStatus = "approved" | "manual" | "rejected";

export type ImageMatchStatus = "exact" | "exact_low_res" | "shared" | "missing";

export type DuplicateStatus =
  | "new_product"
  | "exact_match"
  | "probable_match"
  | "conflict"
  | "sku_collision";

export type IribProduct = {
  line: string;
  official_name: string;
  proposed_name: string;
  brand: string;
  manufacturer: string;
  flavor: string;
  flavor_key: string;
  volume_ml: number;
  volume_text: string;
  package_type: string;
  package_code: IribPackageCode;
  carbonation: string | null;
  source_url: string;
  source_image_url: string | null;
  category: string;
  category_slug: string;
  category_status: "mapped" | "manual";
  proposed_sku: string;
  confidence: "high" | "medium" | "low";
  review_status: ReviewStatus;
  review_reason?: string;
  image_match_status: ImageMatchStatus;
  duplicate_status: DuplicateStatus;
};
