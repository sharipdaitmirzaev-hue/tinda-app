export type PackageCode = "PET" | "CAN" | "GLASS" | "KEG" | "OTHER";

export type Carbonation = "газированная" | "негазированная" | null;

export type Confidence = "high" | "medium" | "low";

export type DiscoveredVariant = {
  line: "gazirovannye" | "water" | "juice_still";
  brand: string;
  product_name: string;
  taste: string | null;
  carbonation: Carbonation;
  volume_ml: number | null;
  volume_text: string | null;
  package: PackageCode | null;
  package_label: string | null;
  source_url: string;
  source_section: string;
  image_url: string | null;
  alcohol_scope: "non_alcoholic" | "alcoholic_excluded" | "unknown";
  confidence: Confidence;
  notes: string;
};

export type DiscoveredPage = {
  id: string;
  url: string;
  path: string;
  http_status: number;
  title: string;
  fetched_at: string;
  variants: DiscoveredVariant[];
  manual_gaps: Array<{ reason: string; evidence: string }>;
};

export type SkippedAlcoholicItem = {
  name: string;
  source_url: string;
  evidence: string;
};

export type ProposedProduct = {
  proposed_sku: string;
  official_name: string;
  proposed_name: string;
  brand: string;
  manufacturer: string;
  category: string;
  category_slug: string;
  category_reason: string;
  volume: string;
  package: string;
  package_code: PackageCode;
  taste: string | null;
  carbonation: Carbonation;
  alcohol_percent: number | null;
  source_url: string;
  image_url: string | null;
  duplicate_status: "new" | "possible_duplicate";
  confidence: Confidence;
  notes: string;
  import_status: "proposed" | "manual_review";
  description: string | null;
};

export type ManualReviewItem = {
  official_name: string;
  brand: string | null;
  source_url: string;
  reason: string;
  evidence: string;
  suggested_action: string;
};

export type ExistingCatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category_id: string | null;
  category_name?: string | null;
  volume_text: string | null;
  package_type: string | null;
  image_url: string | null;
};

export type ExistingCategory = {
  id: string;
  name: string;
  slug: string;
};
