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
 * Stable SKU: BAVARIA-<BRAND>-<PRODUCT>-<VOLUME_ML>-<PACKAGE>
 * Truncates middle segments to stay within DB limit (64).
 */
export function build_bavaria_sku(input: {
  brand: string;
  product_key: string;
  volume_ml: number;
  package: PackageCode;
}): string {
  const vol = volume_to_ml_token(input.volume_ml);
  const pkg = input.package;
  const prefix = "BAVARIA";
  const budget = 64 - `${prefix}-${vol}-${pkg}`.length - 2; // two hyphens between brand/product
  const brand_budget = Math.max(4, Math.min(18, Math.floor(budget * 0.4)));
  const product_budget = Math.max(4, budget - brand_budget);
  const brand = sku_slug(input.brand, brand_budget);
  const product = sku_slug(input.product_key, product_budget);
  const sku = `${prefix}-${brand}-${product}-${vol}-${pkg}`;
  if (sku.length <= 64) return sku;
  return sku.slice(0, 64).replace(/-$/, "");
}
