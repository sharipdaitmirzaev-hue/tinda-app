import type { Carbonation } from "./types";

/** Build TINDA display name: [тип] [бренд] [линейка/вкус] [газ], [объём], [тара] */
export function build_proposed_name(input: {
  type_label: string;
  brand: string;
  line_or_taste: string | null;
  carbonation: Carbonation;
  volume: string;
  package_label: string;
}): string {
  const parts: string[] = [input.type_label];
  if (input.brand) parts.push(input.brand);

  if (input.line_or_taste) {
    const taste = input.line_or_taste.trim();
    // Avoid duplicating brand inside taste
    if (!taste.toLowerCase().includes(input.brand.toLowerCase())) {
      parts.push(taste);
    } else {
      const stripped = taste
        .replace(new RegExp(input.brand, "ig"), "")
        .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
        .trim();
      if (stripped) parts.push(stripped);
    }
  }

  if (input.carbonation) parts.push(input.carbonation);

  const head = parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();

  return `${head}, ${input.volume}, ${input.package_label}`;
}
