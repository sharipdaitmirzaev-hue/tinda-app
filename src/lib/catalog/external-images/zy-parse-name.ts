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
  // Tea / kvass lines before manufacturer «Денеб» (Cyrillic \\b is unreliable)
  { match: /приморск/i, brand: "Приморский" },
  { match: /капитанск\w*\s*бочк/i, brand: "Капитанская бочка" },
  { match: /очаковск/i, brand: "Очаковский" },
  { match: /вятск/i, brand: "Вятский" },
  { match: /лидск/i, brand: "Лидский" },
  { match: /монастырск/i, brand: "Монастырский" },
  { match: /янтарн/i, brand: "Янтарный" },
  { match: /сулакск/i, brand: "Сулакский" },
  { match: /денеб/i, brand: "Денеб" },
  { match: /\bборжоми\b|\bborjomi\b/i, brand: "Боржоми" },
  { match: /\bтбилиссимо\b/i, brand: "Тбилиссимо" },
  { match: /\brich\b|\bрич\b/i, brand: "Rich" },
  { match: /ice\s*bar|айс\s*бар/i, brand: "ICE BAR" },
  { match: /lipton|липтон/i, brand: "Lipton" },
  { match: /nestea|нести/i, brand: "Nestea" },
  { match: /fuze\s*tea|фьюз/i, brand: "FuzeTea" },
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

export type ZyPackageCode =
  | "PET"
  | "CAN"
  | "GLASS"
  | "CARTON"
  | "POUCH"
  | "PACK"
  | "OTHER"
  | "UNK";

/** Canonical juice package codes used by second-pass review. */
export type JuicePackageType =
  | "carton"
  | "pet"
  | "glass"
  | "can"
  | "pouch"
  | "other"
  | "unknown";

export type ParsedZyName = {
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string | null;
  volume_ml: number | null;
  package_type: string | null;
  package_code: ZyPackageCode;
  sugar_free: boolean | null;
};

const PACKAGE_TYPE_TO_CODE: Record<
  Exclude<JuicePackageType, "unknown">,
  ZyPackageCode
> = {
  pet: "PET",
  can: "CAN",
  glass: "GLASS",
  carton: "CARTON",
  pouch: "POUCH",
  other: "OTHER",
};

/** Russian display labels kept for backward-compatible scrape outputs. */
const PACKAGE_TYPE_RU: Record<Exclude<JuicePackageType, "unknown" | "other">, string> =
  {
    pet: "ПЭТ",
    glass: "стекло",
    can: "банка",
    carton: "картон",
    pouch: "пауч",
  };

const CARTON_LIKELY_BRANDS = new Set(
  [
    "добрый",
    "вико",
    "j7",
    "rich",
    "рич",
    "sis",
    "сады придонья",
    "сочная долина",
    "любимый",
    "мой",
    "сантал",
    "дары кубани",
    "фрутоняня",
    "агуша",
    "малышам",
    "маленькое счастье",
  ].map((x) => x.toLowerCase()),
);

/** Typical retail carton / Tetra volumes for juices & nectars (ml). */
const CARTON_TYPICAL_VOLUMES_ML = new Set([
  200, 250, 950, 970, 1000, 1500, 1600, 1930, 2000,
]);

export function juice_package_code(type: JuicePackageType): ZyPackageCode {
  if (type === "unknown") return "UNK";
  return PACKAGE_TYPE_TO_CODE[type];
}

export function juice_package_ru(type: JuicePackageType): string | null {
  if (type === "unknown" || type === "other") return type === "other" ? "другое" : null;
  return PACKAGE_TYPE_RU[type];
}

/**
 * Explicit package markers from title / description / attributes.
 * Ignores transport outer boxes ("коробка 12 шт") unless a unit package is also named.
 */
export function detect_explicit_juice_package(text: string): JuicePackageType {
  const t = lower(text);
  if (!t) return "unknown";

  const has_unit =
    /(пл\s*\/\s*б|пэт|pet|пластик|п\s*\/\s*бут|ст\s*\/\s*б|стекл|ж\s*\/\s*б|банка|тетра|tetra|т\s*\/\s*п|тпак|pure[\s-]?pak|пюр|combibloc|sig\b|дой[\s-]?пак|doypack|pouch|пауч|carton|картон)/.test(
      t,
    );
  const transport_only =
    !has_unit &&
    /(транспортн\w*\s*короб|коробк\w*\s*\d+\s*шт|блок\s*\d+\s*шт|упаковк\w*\s*\d+\s*шт)/.test(
      t,
    );
  if (transport_only) return "unknown";

  if (/(пл\s*\/\s*б|пэт|\bpet\b|пластик|п\s*\/\s*бут)/.test(t)) return "pet";
  if (/(ст\s*\/\s*б|стекл|\bglass\b)/.test(t)) return "glass";
  if (/(ж\s*\/\s*б|жест|алюм|\bcan\b|банка)/.test(t)) return "can";
  if (
    /(тетра|tetra|т\s*\/\s*п|тпак|т-пак|pure[\s-]?pak|пюр[\s-]?пак|combibloc|\bsig\b|brick|carton|картон\w*\s*пак|тетрапак)/.test(
      t,
    )
  ) {
    return "carton";
  }
  if (/(дой[\s-]?пак|doypack|\bpouch\b|пауч|мягк\w*\s*упаков)/.test(t)) {
    return "pouch";
  }
  return "unknown";
}

export type JuicePackageInference = {
  package_type: JuicePackageType;
  package_code: ZyPackageCode;
  confidence: "high" | "medium" | "low";
  source:
    | "name_explicit"
    | "description_explicit"
    | "attributes_explicit"
    | "brand_volume_heuristic"
    | "unknown";
  evidence: string[];
};

/**
 * Infer juice/nectar/mors package for second-pass review.
 * Does not invent package for ambiguous soft drinks without markers.
 */
export function infer_juice_package(input: {
  source_name: string;
  brand?: string | null;
  volume_ml?: number | null;
  product_type?: JuiceProductType | string | null;
  description?: string | null;
  attributes_text?: string | null;
}): JuicePackageInference {
  const evidence: string[] = [];
  const name_pkg = detect_explicit_juice_package(input.source_name);
  if (name_pkg !== "unknown") {
    evidence.push(`name:${name_pkg}`);
    return {
      package_type: name_pkg,
      package_code: juice_package_code(name_pkg),
      confidence: "high",
      source: "name_explicit",
      evidence,
    };
  }

  const desc = String(input.description || "");
  const desc_pkg = detect_explicit_juice_package(desc);
  if (desc_pkg !== "unknown") {
    evidence.push(`description:${desc_pkg}`);
    return {
      package_type: desc_pkg,
      package_code: juice_package_code(desc_pkg),
      confidence: "high",
      source: "description_explicit",
      evidence,
    };
  }

  const attrs = String(input.attributes_text || "");
  const attr_pkg = detect_explicit_juice_package(attrs);
  if (attr_pkg !== "unknown") {
    evidence.push(`attributes:${attr_pkg}`);
    return {
      package_type: attr_pkg,
      package_code: juice_package_code(attr_pkg),
      confidence: "high",
      source: "attributes_explicit",
      evidence,
    };
  }

  const ptype = String(input.product_type || "");
  const brand = lower(input.brand || detect_brand(input.source_name));
  const volume_ml = input.volume_ml ?? parse_volume_ml(input.source_name);
  const brand_ok = CARTON_LIKELY_BRANDS.has(brand);
  const volume_ok =
    volume_ml != null && CARTON_TYPICAL_VOLUMES_ML.has(volume_ml);
  const juice_like = ["juice", "nectar", "mors"].includes(ptype);
  const kids_juice_drink =
    ptype === "juice_drink" &&
    (brand_ok || detect_kids_line(input.source_name)) &&
    volume_ml === 200;

  // Retail juice/nectar cartons (Tetra / Pure-Pak) rarely spell "тетра" in title.
  if ((juice_like || kids_juice_drink) && brand_ok && volume_ok) {
    evidence.push(`brand=${brand}`, `volume_ml=${volume_ml}`, `product_type=${ptype}`);
    return {
      package_type: "carton",
      package_code: "CARTON",
      confidence: kids_juice_drink || volume_ml === 200 || volume_ml === 1000
        ? "high"
        : "medium",
      source: "brand_volume_heuristic",
      evidence,
    };
  }

  evidence.push("no_package_signal");
  return {
    package_type: "unknown",
    package_code: "UNK",
    confidence: "low",
    source: "unknown",
    evidence,
  };
}

function detect_package(name: string): {
  package_type: string | null;
  package_code: ZyPackageCode;
} {
  const explicit = detect_explicit_juice_package(name);
  if (explicit !== "unknown") {
    const code = juice_package_code(explicit);
    const ru = juice_package_ru(explicit);
    return { package_type: ru || explicit, package_code: code };
  }
  if (/(п\s*\/\s*бут|бут)/.test(lower(name)) && /(пэт|pet|пласт)/.test(lower(name))) {
    return { package_type: "ПЭТ", package_code: "PET" };
  }
  if (/п\s*\/\s*бут/.test(lower(name))) {
    return { package_type: "ПЭТ", package_code: "PET" };
  }
  const norm = normalize_package(name);
  if (norm === "pet") return { package_type: "ПЭТ", package_code: "PET" };
  if (norm === "glass") return { package_type: "стекло", package_code: "GLASS" };
  if (norm === "can") return { package_type: "банка", package_code: "CAN" };
  if (norm === "pouch") return { package_type: "пауч", package_code: "POUCH" };
  if (norm === "pack" || norm === "carton") {
    return { package_type: "картон", package_code: "CARTON" };
  }
  if (norm === "other") return { package_type: "другое", package_code: "OTHER" };
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

export type TeaKvassProductType =
  | "iced_tea"
  | "tea_drink"
  | "kombucha"
  | "kvass"
  | "kvass_drink"
  | "unknown";

export function detect_tea_kvass_product_type(
  name: string,
  category_slug?: string | null,
): TeaKvassProductType {
  const t = lower(name);
  if (/комбуч|kombucha/.test(t)) return "kombucha";
  if (/квасн\w*\s*напит|напиток\s*квасн/.test(t)) return "kvass_drink";
  if (/квас/.test(t)) return "kvass";
  if (/холодн\w*\s*чай|чай\s*холодн|ice\s*tea|iced\s*tea|ice\s*bar/.test(t)) {
    return "iced_tea";
  }
  if (/чайн\w*\s*напит|напиток\s*.*чай|tea\s*drink/.test(t)) {
    return "tea_drink";
  }
  const slug = String(category_slug || "").toLowerCase();
  if (slug === "kvas") return "kvass";
  if (slug === "xolodnye-cai") return "iced_tea";
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
