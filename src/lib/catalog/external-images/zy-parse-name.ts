/**
 * Parse «Зелёное яблоко» drink product titles into structured fields.
 * Brand is inferred from the name (site brand attribute is often unreliable).
 */
import {
  extract_flavor_hint,
  lower,
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
  translit,
} from "@/lib/catalog/external-images/normalize";

const KNOWN_BRANDS: Array<{ match: RegExp; brand: string }> = [
  { match: /\bdr\.?\s*pepper\b/i, brand: "Dr. Pepper" },
  { match: /\bcoca[\s-]?cola\b|\bкока[\s-]?кола\b/i, brand: "Coca-Cola" },
  { match: /\bevervess\b/i, brand: "Evervess" },
  { match: /\bfrustyle\b|\bфрустайл\b/i, brand: "Frustyle" },
  { match: /\bkinza\b/i, brand: "KINZA" },
  { match: /\bswag!?\b/i, brand: "SWAG" },
  { match: /\bla\s*cola\b|\bcity\s*cola\b/i, brand: "City Cola" },
  { match: /\bкола\s+от\s+мартина\b/i, brand: "Кола от Мартина" },
  { match: /\bдобрый\b/i, brand: "Добрый" },
  { match: /\bказбеги\b/i, brand: "Казбеги" },
  { match: /\bденеб\b/i, brand: "Денеб" },
  { match: /\bборжоми\b/i, brand: "Боржоми" },
  { match: /\bтбилиссимо\b/i, brand: "Тбилиссимо" },
  { match: /\bрич\b|\brich\b/i, brand: "Rich" },
  { match: /\bsprite\b|\bспрайт\b/i, brand: "Sprite" },
  { match: /\bfanta\b|\bфанта\b/i, brand: "Fanta" },
  { match: /\bla\s*imon|лаймон/i, brand: "Laimon Fresh" },
];

export type ParsedZyName = {
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string | null;
  volume_ml: number | null;
  package_type: string | null;
  package_code: "PET" | "CAN" | "GLASS" | "PACK" | "UNK";
  sugar_free: boolean | null;
};

function detect_package(name: string): {
  package_type: string | null;
  package_code: ParsedZyName["package_code"];
} {
  const t = lower(name);
  if (/(пл\s*\/\s*б|пэт|pet|пластик)/.test(t)) {
    return { package_type: "ПЭТ", package_code: "PET" };
  }
  if (/(ст\s*\/\s*б|стекл)/.test(t)) {
    return { package_type: "стекло", package_code: "GLASS" };
  }
  if (/(ж\s*\/\s*б|жест|алюм|банка|\bcan\b)/.test(t)) {
    return { package_type: "банка", package_code: "CAN" };
  }
  const norm = normalize_package(name);
  if (norm === "pet") return { package_type: "ПЭТ", package_code: "PET" };
  if (norm === "glass") return { package_type: "стекло", package_code: "GLASS" };
  if (norm === "can") return { package_type: "банка", package_code: "CAN" };
  if (norm === "pack") return { package_type: "упаковка", package_code: "PACK" };
  return { package_type: null, package_code: "UNK" };
}

function detect_brand(name: string): string {
  for (const row of KNOWN_BRANDS) {
    if (row.match.test(name)) return row.brand;
  }
  // Fallback: first meaningful token after «Напиток …»
  const cleaned = name
    .replace(/^напиток\s+(газир(?:ованный|ованный|)\s*)?/i, "")
    .replace(/^газир(?:ованный)?\s+/i, "")
    .trim();
  const token = cleaned.split(/\s+/)[0] || "UNKNOWN";
  return token.replace(/[!,.]+$/g, "");
}

function format_volume_text(ml: number | null, raw: string): string | null {
  if (ml == null) {
    const m = lower(raw).match(/(\d+[.,]?\d*)\s*(л|мл|l|ml)\b/);
    return m ? `${m[1].replace(",", ".")} ${m[2]}` : null;
  }
  if (ml >= 1000 && ml % 1000 === 0) return `${ml / 1000} л`;
  if (ml >= 1000) return `${(ml / 1000).toString().replace(".", ",")} л`;
  return `${ml} мл`;
}

export function parse_zy_product_name(source_name: string): ParsedZyName {
  const brand = detect_brand(source_name);
  let volume_ml = parse_volume_ml(source_name);
  // Retail shorthand: "0,33 ж/б" / "0.5 пэт" without explicit л/мл → liters if < 10
  if (volume_ml == null) {
    const m = lower(source_name)
      .replace(/,/g, ".")
      .match(/(\d+(?:\.\d+)?)\s*(?:ж\s*\/\s*б|пл\s*\/\s*б|пэт|ст\s*\/\s*б|банк)/i);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n < 10) volume_ml = Math.round(n * 1000);
      else if (n >= 10 && n < 10000) volume_ml = Math.round(n);
    }
  }
  const volume_text = format_volume_text(volume_ml, source_name);
  const pkg = detect_package(source_name);
  const sugar_free = sugar_free_flag(source_name);
  let flavor = extract_flavor_hint(
    source_name,
    brand,
    volume_text,
    pkg.package_type,
  );
  flavor = flavor
    .replace(/\b(напиток|газир(?:ованный|ованный)?|газ)\b/gi, " ")
    .replace(/\b(зеро|zero|sugar[\s-]?free)\b/gi, " ")
    .replace(/\b(классик|classic|original)\b/gi, " ")
    .replace(/\d+[.,]?\d*\s*(г|kg|кг)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    source_name,
    brand,
    flavor,
    volume_text,
    volume_ml,
    package_type: pkg.package_type,
    package_code: pkg.package_code,
    sugar_free,
  };
}

export function brand_code(brand: string): string {
  const t = translit(brand).replace(/[^a-z0-9]+/g, "").toUpperCase();
  return (t || "BRAND").slice(0, 16);
}

export function volume_code(ml: number | null): string {
  if (ml == null) return "VOL";
  return String(ml);
}

export function build_zy_sku(
  brand: string,
  volume_ml: number | null,
  package_code: string,
  seq: number,
): string {
  const parts = [
    "ZY",
    brand_code(brand),
    volume_code(volume_ml),
    (package_code || "UNK").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    String(seq).padStart(3, "0"),
  ];
  return parts.join("-").replace(/[^A-Z0-9-]/g, "");
}

export function dedupe_key(p: {
  brand: string;
  source_name: string;
  flavor: string;
  volume_text: string | null;
  package_type: string | null;
  sugar_free: boolean | null;
}): string {
  return [
    normalize_brand(p.brand),
    lower(p.flavor),
    String(parse_volume_ml(p.volume_text) ?? ""),
    normalize_package(p.package_type || p.source_name),
    p.sugar_free === true ? "sf" : p.sugar_free === false ? "reg" : "unk",
  ].join("|");
}
