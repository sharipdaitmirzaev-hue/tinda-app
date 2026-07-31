import type { Carbonation, PackageCode } from "./types";

function package_ru(code: PackageCode): string {
  if (code === "PET") return "ПЭТ";
  if (code === "GLASS") return "стекло";
  if (code === "CAN") return "банка";
  if (code === "KEG") return "кег";
  return "тара";
}

/**
 * Display name: [бренд] [вкус/продукт] [газ], [объём], [тара]
 * Kept close to Bavaria naming style used in TINDA catalog.
 */
export function build_daryal_name(input: {
  brand: string;
  product_name: string;
  taste: string | null;
  carbonation: Carbonation;
  volume_text: string;
  package: PackageCode;
}): string {
  const parts: string[] = [];
  parts.push(input.brand.trim());

  const taste = (input.taste || "").trim();
  const product = input.product_name.trim();
  if (taste && !product.toLowerCase().includes(taste.toLowerCase())) {
    parts.push(taste);
  } else if (product && !product.toLowerCase().includes(input.brand.toLowerCase())) {
    parts.push(product);
  } else if (taste) {
    parts.push(taste);
  }

  if (input.carbonation) {
    parts.push(input.carbonation);
  }

  const head = parts.join(" ").replace(/\s+/g, " ").trim();
  return `${head}, ${input.volume_text}, ${package_ru(input.package)}`;
}
