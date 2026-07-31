export type AlcoholDecision =
  | { kind: "non_alcoholic"; alcohol_percent: number | null; evidence: string }
  | { kind: "alcoholic"; alcohol_percent: number | null; evidence: string }
  | { kind: "unknown"; alcohol_percent: number | null; evidence: string };

export type PackageCode = "PET" | "CAN" | "GLASS" | "KEG" | "OTHER";

export type Carbonation = "газированная" | "негазированная" | null;
export type SugarFlag = "с сахаром" | "без сахара" | null;

export type TindaCategoryTarget = {
  name: string;
  slug: string;
  exists: boolean;
  create_proposed: boolean;
};

export type ParsedPackVolume = {
  volume_text: string;
  volume_ml: number;
  package: PackageCode;
  package_label: string;
};

export type RawSliderVariant = {
  variant_title: string;
  text: string;
  text_html: string;
  image: string | null;
};

export type DiscoveredProduct = {
  path: string;
  url: string;
  slug: string;
  source_categories: string[];
  official_name: string;
  page_title: string;
  variants: RawSliderVariant[];
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
  sugar: SugarFlag;
  alcohol_percent: number | null;
  source_url: string;
  image_url: string | null;
  local_image_path: string | null;
  duplicate_status: "new" | "possible_duplicate";
  confidence: "high" | "medium" | "low";
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

export type SkippedAlcoholicItem = {
  name: string;
  brand: string;
  alcohol_percent: number | null;
  url: string;
  reason: string;
};

export type PossibleDuplicate = {
  proposed_sku: string;
  proposed_name: string;
  existing_sku: string;
  existing_name: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type ExistingCatalogProduct = {
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  image_url: string | null;
  category_name?: string | null;
};

export type ExistingCategory = {
  id: string;
  name: string;
  slug: string;
};
