/**
 * Normalize product display text (names, volume_text) for ТИНДА catalog.
 * Safe, idempotent, brand-preserving.
 */

const VOLUME_TOKEN_RE =
  /(\d+(?:[.,]\d+)?)\s*(мл|л|кг|шт)\.?/gi;

/** Collapse whitespace and trim. */
export function squash_spaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Normalize a single numeric+unit token: 0.5л → 0,5 л; 200мл → 200 мл; 1л. → 1 л */
export function normalize_volume_token(raw_num: string, raw_unit: string): string {
  const unit = raw_unit.toLowerCase().replace(/\.$/, "");
  let num = raw_num.replace(/\./g, ",");
  if (num.includes(",")) {
    const [whole, frac = ""] = num.split(",", 2);
    const trimmed_frac = frac.replace(/0+$/, "");
    num = trimmed_frac ? `${whole},${trimmed_frac}` : whole;
  }
  return `${num} ${unit}`;
}

/** Replace volume tokens inside free text; leave other words (including brands) intact. */
export function normalize_volumes_in_text(value: string): string {
  if (!value) return value;
  return value.replace(VOLUME_TOKEN_RE, (_match, num: string, unit: string) =>
    normalize_volume_token(num, unit),
  );
}

/** Normalize product name: spaces + volume tokens. Does not translate brands. */
export function normalize_product_name(name: string): string {
  return squash_spaces(normalize_volumes_in_text(name));
}

/** Normalize volume_text field. Empty stays empty. */
export function normalize_volume_text(
  volume_text: string | null | undefined,
): string | null {
  if (volume_text === null || volume_text === undefined) return null;
  const trimmed = squash_spaces(volume_text);
  if (!trimmed) return null;
  return normalize_volumes_in_text(trimmed);
}

/**
 * Fingerprint for near-duplicate detection (not for display).
 * Expands a few Russian abbreviations used in wholesale catalogs.
 */
export function product_name_fingerprint(name: string): string {
  let s = normalize_product_name(name).toLowerCase().replace(/ё/g, "е");
  s = s.replace(/[«»"'`]/g, "");
  s = s.replace(/[,./;:()[\]\-]+/g, " ");
  s = squash_spaces(s);
  const abbrevs: Array<[RegExp, string]> = [
    [/\bнегаз\b/g, "негазированная"],
    [/\bнегазир\b/g, "негазированная"],
    [/\bгаз\b/g, "газированная"],
    [/\bгазир\b/g, "газированная"],
    [/\bмин\b/g, "минеральная"],
    [/\bминер\b/g, "минеральная"],
    [/\bпэт\b/g, "пет"],
    [/\bпл\/б\b/g, "пет"],
    [/\bст\/б\b/g, "стекло"],
  ];
  for (const [re, repl] of abbrevs) {
    s = s.replace(re, repl);
  }
  return squash_spaces(s);
}

export type ProductDedupeKeyInput = {
  name: string;
  brand?: string | null;
  volume_text?: string | null;
  package_type?: string | null;
  units_per_package?: number | null;
};

/** Stable key for "same commercial SKU line" grouping (not DB unique). */
export function product_dedupe_key(input: ProductDedupeKeyInput): string {
  const brand = squash_spaces(input.brand ?? "").toLowerCase().replace(/ё/g, "е");
  const name = product_name_fingerprint(input.name);
  const volume = (normalize_volume_text(input.volume_text) ?? "")
    .toLowerCase()
    .replace(/ё/g, "е");
  const pkg = squash_spaces(input.package_type ?? "")
    .toLowerCase()
    .replace(/ё/g, "е");
  const upp = String(input.units_per_package ?? 1);
  return [brand, name, volume, pkg, upp].join("|");
}
