import type { DuplicateStatus, IribProduct } from "./types";

export type ExistingCatalogProduct = {
  sku?: string | null;
  name?: string | null;
  brand?: string | null;
  volume_text?: string | null;
  package_type?: string | null;
};

const IRIB_BRAND_HINTS = [
  "ириб",
  "irib",
  "selesta",
  "селеста",
  "bro lemon",
  "mindari",
  "миндари",
  "ice bar",
  "ace bar",
  "gold grand",
  "profi sport",
  "талих",
  "talih",
  "тарки",
  "tarki",
  "родничок",
  "чегери",
];

export function same_identity(a: IribProduct, b: IribProduct): boolean {
  return (
    a.line === b.line &&
    a.flavor_key === b.flavor_key &&
    a.volume_ml === b.volume_ml &&
    a.package_code === b.package_code &&
    (a.carbonation || "") === (b.carbonation || "")
  );
}

function parse_volume_ml(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g, "");
  const ml = t.match(/(\d+(?:[.,]\d+)?)\s*мл/);
  if (ml) return Math.round(parseFloat(ml[1].replace(",", ".")));
  const l = t.match(/(\d+(?:[.,]\d+)?)\s*л/);
  if (l) return Math.round(parseFloat(l[1].replace(",", ".")) * 1000);
  const bare = t.match(/^(\d+)$/);
  if (bare) {
    const n = parseInt(bare[1], 10);
    if (n >= 100) return n;
  }
  return null;
}

function package_compatible(a: string, b: string | null | undefined): boolean {
  const x = a.toLowerCase();
  const y = (b || "").toLowerCase();
  if (!y) return true;
  const glass = (s: string) => s.includes("стекл") || s.includes("glass");
  const pet = (s: string) => s.includes("пэт") || s.includes("pet") || s.includes("пластик");
  const can = (s: string) => s.includes("банк") || s.includes("can") || s.includes("жесть");
  if (glass(x) && glass(y)) return true;
  if (pet(x) && pet(y)) return true;
  if (can(x) && can(y)) return true;
  return x === y;
}

function flavor_overlap(product: IribProduct, name: string): boolean {
  const n = name.toLowerCase();
  const flavor = product.flavor.toLowerCase();
  if (flavor && n.includes(flavor)) return true;
  const key = product.flavor_key.toLowerCase().replace(/-/g, " ");
  const parts = key.split(" ").filter((p) => p.length >= 4);
  return parts.some((p) => n.includes(p));
}

export function classify_against_production(
  product: IribProduct,
  existing: ExistingCatalogProduct[],
): DuplicateStatus {
  const sku = product.proposed_sku.toUpperCase();
  for (const ex of existing) {
    if ((ex.sku || "").toUpperCase() === sku) return "sku_collision";
  }

  for (const ex of existing) {
    const name = ex.name || "";
    const brand = (ex.brand || "").toLowerCase();
    const ex_sku = (ex.sku || "").toUpperCase();
    const brand_hit =
      IRIB_BRAND_HINTS.some((h) => brand.includes(h) || name.toLowerCase().includes(h)) ||
      ex_sku.startsWith("ZY-IRIB") ||
      ex_sku.startsWith("IRIB-");
    if (!brand_hit) continue;

    const prodBrand = product.brand.toLowerCase().replace(/-/g, " ");
    const nameN = name.toLowerCase().replace(/-/g, " ");
    const brandN = brand.replace(/-/g, " ");
    if (prodBrand && !["ириб", "irib"].includes(prodBrand)) {
      const token = prodBrand.split(/\s+/)[0] || "";
      if (token.length >= 4 && !brandN.includes(token) && !nameN.includes(token)) {
        continue;
      }
    }

    const vol = parse_volume_ml(ex.volume_text) ?? parse_volume_ml(name);
    const same_vol = vol != null && vol === product.volume_ml;
    const same_pkg = package_compatible(product.package_type, ex.package_type);
    const flavorHit =
      flavor_overlap(product, nameN) ||
      (product.line === "TARKI-TAU" && (nameN.includes("тарки") || nameN.includes("tarki")));
    if (same_vol && same_pkg && flavorHit) {
      return "exact_match";
    }
    if (same_vol && flavorHit) {
      return "probable_match";
    }
    if (flavorHit && same_pkg) {
      return "probable_match";
    }
  }

  return "new_product";
}
