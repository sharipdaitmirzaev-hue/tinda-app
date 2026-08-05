import type { PackageCode } from "./types";

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** Deterministic ASCII slug for SKU segments (max length enforced by caller). */
export function sku_slug(value: string, max = 24): string {
  const lower = value.trim().toLowerCase().replace(/ё/g, "е");
  let out = "";
  for (const ch of lower) {
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      continue;
    }
    if (CYR_TO_LAT[ch] !== undefined) {
      out += CYR_TO_LAT[ch];
      continue;
    }
    if (/[\s_\-./\\,+&'«»"()]/.test(ch)) {
      out += "-";
    }
  }
  out = out
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
  if (out.length <= max) return out || "X";
  return out.slice(0, max).replace(/-$/, "") || "X";
}

export function volume_to_ml_token(volume_ml: number): string {
  return String(Math.round(volume_ml));
}

/**
 * Stable SKU: DARYAL-<BRAND>-<PRODUCT>-<VOLUME_ML>-<PACKAGE>
 * Truncates middle segments to stay within DB limit (64).
 */
export function build_daryal_sku(input: {
  brand: string;
  product_key: string;
  volume_ml: number;
  package: PackageCode;
}): string {
  const vol = volume_to_ml_token(input.volume_ml);
  const pkg = input.package;
  const prefix = "DARYAL";
  const fixed = `${prefix}--${vol}-${pkg}`; // placeholders for length budget
  const budget = 64 - fixed.length + 1; // account for one hyphen restored below
  // prefix + brand + product + vol + pkg + 4 hyphens
  const overhead = prefix.length + vol.length + pkg.length + 4;
  let brand_max = Math.min(18, Math.floor((64 - overhead) * 0.4));
  let product_max = 64 - overhead - brand_max;
  if (product_max < 8) {
    brand_max = Math.max(6, brand_max - (8 - product_max));
    product_max = 64 - overhead - brand_max;
  }
  const brand = sku_slug(input.brand, brand_max);
  const product = sku_slug(input.product_key, product_max);
  const sku = `${prefix}-${brand}-${product}-${vol}-${pkg}`;
  if (sku.length <= 64) return sku;
  return sku.slice(0, 64).replace(/-$/, "");
}
