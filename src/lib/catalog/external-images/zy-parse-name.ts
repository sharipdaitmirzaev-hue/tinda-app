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
  { match: /\bборжоми\b|\bborjomi\b/i, brand: "Боржоми" },
  { match: /\bтбилиссимо\b/i, brand: "Тбилиссимо" },
  { match: /\bрич\b|\brich\b/i, brand: "Rich" },
  { match: /\bsprite\b|\bспрайт\b/i, brand: "Sprite" },
  { match: /\bfanta\b|\bфанта\b/i, brand: "Fanta" },
  { match: /\bla\s*imon|лаймон/i, brand: "Laimon Fresh" },
  // Energy drink brands (avoid \b with Cyrillic — JS word boundaries are ASCII-only)
  { match: /burn|берн/i, brand: "Burn" },
  { match: /red\s*bull|ред\s*булл/i, brand: "Red Bull" },
  { match: /monster|монстер/i, brand: "Monster" },
  { match: /adrenaline(\s*rush)?|адреналин(\s*раш)?/i, brand: "Adrenaline Rush" },
  { match: /flash(\s*up)?|флэш(\s*ап)?|флеш(\s*ап)?/i, brand: "Flash Up" },
  { match: /drive\s*me|драйв\s*ми/i, brand: "Drive Me" },
  { match: /gorilla|горилла/i, brand: "Gorilla" },
  { match: /tornado|торнадо/i, brand: "Tornado" },
  { match: /battery|баттери/i, brand: "Battery" },
  { match: /lit\s*energy|лит\s*энерджи/i, brand: "Lit Energy" },
  { match: /coolcola|cool\s*cola/i, brand: "CoolCola" },
  { match: /(?<![a-zа-я])revo(?![a-zа-я])|рево/i, brand: "Revo" },
  { match: /black\s*monster/i, brand: "Black Monster" },
  { match: /jaguar|ягуар/i, brand: "Jaguar" },
  { match: /bizon|бизон/i, brand: "Bizon" },
  { match: /genom|геном/i, brand: "Genom" },
  { match: /tornado\s*energy/i, brand: "Tornado" },
  // Juice / nectar / mors brands
  { match: /фруто\s*няня|фрутоняня/i, brand: "ФрутоНяня" },
  { match: /агуша/i, brand: "Агуша" },
  { match: /дары\s*кубани/i, brand: "Дары Кубани" },
  { match: /малышам/i, brand: "Малышам" },
  { match: /маленькое\s*счастье/i, brand: "Маленькое Счастье" },
  { match: /сады\s*придонья/i, brand: "Сады Придонья" },
  { match: /сочная\s*долина/i, brand: "Сочная долина" },
  { match: /любимый/i, brand: "Любимый" },
  { match: /(?<![a-zа-я])вико(?![a-zа-я])/i, brand: "Вико" },
  { match: /(?<![a-z0-9])j7(?![a-z0-9])/i, brand: "J7" },
  { match: /(?<![a-zа-я])yan(?![a-zа-я])/i, brand: "Yan" },
  { match: /(?<![a-zа-я])sis(?![a-zа-я])/i, brand: "SIS" },
  { match: /rusberries/i, brand: "Rusberries" },
  { match: /кикуни/i, brand: "Кикуни" },
  { match: /гуниб/i, brand: "Гуниб" },
  { match: /сильбеси/i, brand: "Сильбеси" },
  { match: /сантал|santal/i, brand: "Сантал" },
  { match: /мой\s*(?:сок|нектар|морс)?/i, brand: "Мой" },
  { match: /свитч|switch/i, brand: "Switch" },
  { match: /vinut|вину/i, brand: "Vinut" },
  // Water brands
  { match: /\bаква\s*минерале\b|\baqua\s*minerale\b/i, brand: "Аква Минерале" },
  { match: /\bаква\s*панна\b|\baqua\s*panna\b/i, brand: "Аква Панна" },
  { match: /\bархыз\b/i, brand: "Архыз" },
  { match: /\bнарзан\b/i, brand: "Нарзан" },
  { match: /\bессентуки\b/i, brand: "Ессентуки" },
  { match: /\bнабеглави\b/i, brand: "Набеглави" },
  { match: /\bсерноводск/i, brand: "Серноводская" },
  { match: /\bшишкин\s*лес\b/i, brand: "Шишкин Лес" },
  { match: /\bродники\s*кавказа\b/i, brand: "Родники Кавказа" },
  { match: /\bродниковая\s*свежесть\b/i, brand: "Родниковая Свежесть" },
  { match: /\bтри\s*горянки\b/i, brand: "Три Горянки" },
  { match: /\bлегенда\s*байкала\b/i, brand: "Легенда Байкала" },
  { match: /\bмевер\b/i, brand: "Мевер" },
  { match: /\bkubay\b|\bкубай\b/i, brand: "Кубай" },
  { match: /\bsabr\b/i, brand: "Sabr" },
  { match: /\bgorji\b|\bгоджи\b/i, brand: "Gorji" },
  { match: /\bdonat\b/i, brand: "Donat" },
  { match: /\bdoctor\s*bormental\b/i, brand: "Doctor Bormental" },
  { match: /\bdoctor\s*wasser\b/i, brand: "DoctorWasser" },
  { match: /\bнагутск/i, brand: "Нагутская" },
  { match: /\bнагутти\b/i, brand: "Нагутти" },
  { match: /\bаллея\s*источников\b/i, brand: "Аллея Источников" },
  { match: /\bрецепт\s*от\s*природы\b/i, brand: "Рецепт от природы" },
  { match: /\birib\b|\bириб\b/i, brand: "Ириб" },
];

/** sparkling | still | unknown — for water category matching */
export function detect_carbonation(
  text: string,
  category_hint?: string | null,
): "sparkling" | "still" | "unknown" {
  const hint = String(category_hint || "").toLowerCase();
  if (hint.includes("negaz") || hint.includes("still")) return "still";
  if (hint.includes("gazirov") && !hint.includes("napitk")) return "sparkling";
  if (hint === "sparkling" || hint === "still") return hint;

  const t = lower(text);
  if (/(не\s*газ|без\s*газ|negaz|still|без газа)/.test(t)) return "still";
  if (/(газир|с\s*газ|\bгаз\b|sparkling|borjomi|нарзан|ессентук)/.test(t)) {
    // bare "газ" at end of water titles is sparkling; avoid soft drinks category noise
    return "sparkling";
  }
  return "unknown";
}

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
  if (/(тетра|tetra|т\s*\/\s*п|тпак|т-пак|карто|пюр[-]?пак|combibloc|brick)/.test(t)) {
    return { package_type: "картон", package_code: "CARTON" };
  }
  if (/(п\s*\/\s*бут|бут)/.test(t) && /(пэт|pet|пласт)/.test(t)) {
    return { package_type: "ПЭТ", package_code: "PET" };
  }
  if (/п\s*\/\s*бут/.test(t)) {
    return { package_type: "ПЭТ", package_code: "PET" };
  }
  const norm = normalize_package(name);
  if (norm === "pet") return { package_type: "ПЭТ", package_code: "PET" };
  if (norm === "glass") return { package_type: "стекло", package_code: "GLASS" };
  if (norm === "can") return { package_type: "банка", package_code: "CAN" };
  if (norm === "pack" || norm === "carton") {
    return { package_type: "картон", package_code: "CARTON" };
  }
  return { package_type: null, package_code: "UNK" };
}

function detect_brand(name: string): string {
  for (const row of KNOWN_BRANDS) {
    if (row.match.test(name)) return row.brand;
  }
  // Water titles often start with «Вода …»
  const water = name.match(/^вода\s+(.+)$/i);
  if (water) {
    const rest = water[1]!.trim();
    for (const row of KNOWN_BRANDS) {
      if (row.match.test(rest)) return row.brand;
    }
    const token = rest.split(/\s+/)[0] || "UNKNOWN";
    return token.replace(/[!,.]+$/g, "");
  }
  // Fallback: first meaningful token after «Напиток …» / «энергетический …» / juice prefixes
  const cleaned = name
    .replace(/^напиток\s+(газир(?:ованный|ованный|)\s*)?/i, "")
    .replace(/^газир(?:ованный)?\s+/i, "")
    .replace(/энергетическ(?:ий|ие|ая)?/gi, " ")
    .replace(/energy\s*drink/gi, " ")
    .replace(/^(сок|нектар|морс)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Re-check known brands on cleaned title (Cyrillic \b is unreliable).
  for (const row of KNOWN_BRANDS) {
    if (row.match.test(cleaned) || row.match.test(name)) return row.brand;
  }
  const token = cleaned.split(/\s+/)[0] || "UNKNOWN";
  return token.replace(/[!,.]+$/g, "");
}

export type JuiceProductType = "juice" | "nectar" | "mors" | "juice_drink" | "unknown";

export function detect_juice_product_type(name: string): JuiceProductType {
  const t = lower(name);
  if (/нектар/.test(t)) return "nectar";
  if (/морс/.test(t)) return "mors";
  if (/сокосодерж|вода\s*и\s*сок|juice\s*drink|палпи|pulpy/.test(t)) {
    return "juice_drink";
  }
  if (/(^|\s)сок(\s|$)|apple\s*juice|orange\s*juice/.test(t)) return "juice";
  if (
    /напиток/.test(t) &&
    /(сок|фрукт|ягод|апельсин|манго|личи|ананас|яблок|персик|виноград|банан|мульти)/.test(
      t,
    )
  ) {
    return "juice_drink";
  }
  if (/базил|basil\s*seed|вину|vinut/.test(t)) return "juice_drink";
  return "unknown";
}

export function detect_pulp(name: string): boolean | null {
  const t = lower(name);
  if (/с\s*мякот|с\s*мякуш/.test(t)) return true;
  if (/осветл|без\s*мякот/.test(t)) return false;
  return null;
}

export function detect_kids_line(name: string, category_slug?: string | null): boolean {
  const slug = String(category_slug || "").toLowerCase();
  if (slug.includes("detsk") || slug === "voda-soki") return true;
  return /(детск|фруто\s*няня|фрутоняня|агуша|малышам|маленькое\s*счастье|маша\s*и\s*медведь|фиксик)/i.test(
    name,
  );
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
