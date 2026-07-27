export function build_package_info(product: {
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  allow_piece_sale: boolean;
}): string {
  const parts = [
    product.volume_text,
    product.package_type,
    `${product.units_per_package} шт. в упаковке`,
  ].filter((part): part is string => Boolean(part && String(part).trim()));

  if (product.allow_piece_sale) {
    parts.push("поштучно");
  }

  return parts.join(" · ").slice(0, 255);
}
