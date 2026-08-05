import type { AquAlaniaProduct, DuplicateStatus } from "./types";

export type ExistingCatalogProduct = {
  sku?: string | null;
  name?: string | null;
  brand?: string | null;
  volume_text?: string | null;
  package_type?: string | null;
};

/** Same flavor across different AquAlania lines / packages are distinct SKUs. */
export function same_identity(a: AquAlaniaProduct, b: AquAlaniaProduct): boolean {
  return (
    a.line === b.line &&
    a.flavor_key === b.flavor_key &&
    a.volume_ml === b.volume_ml &&
    a.package_code === b.package_code &&
    Boolean(a.sugar_free) === Boolean(b.sugar_free) &&
    (a.carbonation || "") === (b.carbonation || "")
  );
}

export function is_distinct_packaging_variant(a: AquAlaniaProduct, b: AquAlaniaProduct): boolean {
  if (a.flavor_key.split("-")[0] !== b.flavor_key.split("-")[0] && a.flavor !== b.flavor) {
    // still allow glass vs can for same human flavor
  }
  const same_flavor =
    a.flavor === b.flavor ||
    a.flavor_key.replace(/-/g, "") === b.flavor_key.replace(/-/g, "") ||
    (a.flavor.includes("Мохито") && b.flavor.includes("Мохито") && a.line !== b.line);
  if (!same_flavor) return false;
  return a.package_code !== b.package_code || a.line !== b.line || a.volume_ml !== b.volume_ml;
}

export function classify_against_production(
  product: AquAlaniaProduct,
  existing: ExistingCatalogProduct[],
): DuplicateStatus {
  const sku = product.proposed_sku.toUpperCase();
  for (const ex of existing) {
    if ((ex.sku || "").toUpperCase() === sku) return "sku_collision";
  }
  const brand_hits = existing.filter((ex) => {
    const name = (ex.name || "").toLowerCase();
    const brand = (ex.brand || "").toLowerCase();
    const ex_sku = (ex.sku || "").toUpperCase();
    return (
      brand.includes("aqualania") ||
      brand.includes("аквалания") ||
      name.includes("aqualania") ||
      name.includes("аквалания") ||
      ex_sku.startsWith("AQUALANIA-")
    );
  });
  if (brand_hits.length) return "probable_match";
  return "new_product";
}

export function water_still_and_sparkling_are_distinct(
  a: AquAlaniaProduct,
  b: AquAlaniaProduct,
): boolean {
  return (
    a.line === "WATER" &&
    b.line === "WATER" &&
    a.flavor_key !== b.flavor_key &&
    !same_identity(a, b)
  );
}
