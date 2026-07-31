import type { DiscoveredProduct, TindaCategoryTarget } from "./types";

export const MANUFACTURER = "ГК ПД «Бавария»";

const OTHER_ALIASES = [
  "другие",
  "другое",
  "прочее",
  "прочие",
  "прочие товары",
  "other",
];

export function find_other_category(
  categories: { name: string; slug: string }[],
): { name: string; slug: string } | null {
  for (const c of categories) {
    const n = c.name.trim().toLowerCase();
    const s = c.slug.trim().toLowerCase();
    if (OTHER_ALIASES.includes(n) || OTHER_ALIASES.includes(s)) {
      return { name: c.name, slug: c.slug };
    }
  }
  return null;
}

export function propose_other_category(
  categories: { name: string; slug: string }[],
): TindaCategoryTarget {
  const existing = find_other_category(categories);
  if (existing) {
    return {
      name: existing.name,
      slug: existing.slug,
      exists: true,
      create_proposed: false,
    };
  }
  const slug_taken = categories.some((c) => c.slug.toLowerCase() === "other");
  return {
    name: "Другие",
    slug: slug_taken ? "other-drinks" : "other",
    exists: false,
    create_proposed: true,
  };
}

export function detect_brand(
  product: Pick<DiscoveredProduct, "official_name" | "slug" | "source_categories">,
  variant_title = "",
): string {
  const blob = `${product.official_name} ${variant_title} ${product.slug}`.toLowerCase();

  if (/tbau|тбау/.test(blob) || product.source_categories.some((c) => /tbau/.test(c))) {
    return "TBAU";
  }
  if (/kazbek|казбек/.test(blob) || product.source_categories.some((c) => /kazbek/.test(c))) {
    return "Kazbek-Aqua";
  }
  if (/rocket\s*ride|rocket-ride/.test(blob)) return "Rocket Ride";
  if (/black\s*rocket/.test(blob)) return "BLACK ROCKET";
  if (/dreamix/.test(blob)) return "Dreamix";
  if (/mountea/.test(blob)) return "MOUNTEA";
  if (/добрецов/.test(blob)) return "Добрецовъ";
  if (/хонг|honga/.test(blob)) return "ХОНГÆ";
  if (/swipe/.test(blob)) return "SWIPE";
  if (/лимнад/.test(blob)) return "Лимнада";
  if (/чайка|ретро/.test(blob)) return "Бавария";
  if (/premium|кола|лимонад|мохито|new orange|ф»|«ф/.test(blob)) return "Бавария";
  if (/elf|светлое|бавария|nordisch|gallagher|бойлер/.test(blob)) return "Бавария";
  if (/вкусвилл/.test(blob)) return "ВкусВилл";
  if (/айва/.test(blob)) return "Айва";
  if (/аварал/.test(blob)) return "Аварал";
  if (/горная вода/.test(blob)) return "Горная вода";
  if (/cola limited|кола limited/.test(blob)) return "Cola Limited Edition";

  return "Бавария";
}

export type CategoryDecision = {
  category: string;
  category_slug: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  is_other: boolean;
  create_proposed?: boolean;
};

/**
 * Map official product type → TINDA category (by meaning, not only name words).
 */
export function classify_category(
  product: DiscoveredProduct,
  options: {
    brand: string;
    alcohol_kind: "non_alcoholic" | "alcoholic" | "unknown";
    other: TindaCategoryTarget;
    existing_slugs: Set<string>;
  },
): CategoryDecision {
  const blob = `${product.official_name} ${product.page_title} ${product.slug} ${product.source_categories.join(" ")}`.toLowerCase();
  const brand = options.brand.toLowerCase();

  const beer_context =
    /пиво|bier|lager|\bэль\b|elf»\s*безалкогол|светлое»\s*безалкогол/.test(
      blob,
    ) || product.source_categories.some((c) => /pivo-i-sidr/i.test(c));
  if (
    options.alcohol_kind === "non_alcoholic" &&
    beer_context &&
    !/лимонад|тоник|кола|квас|чай|вода|rocket|dreamix|mountea|напиток\s+безалкогольн/i.test(
      blob,
    )
  ) {
    const slug = "bezalkogolnoe-pivo";
    return {
      category: "Безалкогольное пиво",
      category_slug: slug,
      reason: "Подтверждённое безалкогольное пиво",
      confidence: "high",
      is_other: false,
      create_proposed: !options.existing_slugs.has(slug),
    };
  }

  if (brand === "tbau" || /тбау|tbau|родниковая вода/.test(blob)) {
    return {
      category: "Питьевая вода",
      category_slug: "voda-pitevaya",
      reason: "TBAU / горная родниковая питьевая вода",
      confidence: "high",
      is_other: false,
    };
  }

  if (brand === "kazbek-aqua" || /казбек|лечебно-столовая|минеральн/.test(blob)) {
    return {
      category: "Минеральная вода",
      category_slug: "voda-mineralnaya",
      reason: "Kazbek-Aqua / минеральная лечебно-столовая вода",
      confidence: "high",
      is_other: false,
    };
  }

  if (/tonic|тоник/.test(blob) || brand === "dreamix") {
    // Dreamix.Tonic line and Dreamix flavored — tonics vs sodas:
    if (/toni[сc]|tonic|тоник/.test(blob)) {
      return {
        category: "Тоники",
        category_slug: "toniki",
        reason: "Dreamix / тоник по официальному типу",
        confidence: "high",
        is_other: false,
      };
    }
  }

  if (/rocket ride|энерг|vitaminnyj-napitok-rocket|black rocket/.test(blob)) {
    return {
      category: "Энергетические напитки",
      category_slug: "energeticheskie-napitki",
      reason: "Официально витаминный/энергетический напиток",
      confidence: /rocket/.test(blob) ? "high" : "medium",
      is_other: false,
    };
  }

  if (/mountea|холодный чай|holodnyj-caj|botanic/.test(blob)) {
    return {
      category: "Холодный чай",
      category_slug: "kholodnyy-chay",
      reason: "Холодный чай / MOUNTEA",
      confidence: "high",
      is_other: false,
    };
  }

  if (/квас|dobrecov|добрецов/.test(blob)) {
    return {
      category: "Квас",
      category_slug: "kvas",
      reason: "Хлебный квас",
      confidence: "high",
      is_other: false,
    };
  }

  if (/сокосодерж|нектар|\bсок\b|sokosoder/.test(blob)) {
    return {
      category: "Сокосодержащие напитки",
      category_slug: "sokosoderzhashchie-napitki",
      reason: "Официально сокосодержащий напиток",
      confidence: "high",
      is_other: false,
    };
  }

  if (/кола|cola/.test(blob)) {
    return {
      category: "Газированные напитки",
      category_slug: "gazirovannye-napitki",
      reason: "Кола / газированный напиток",
      confidence: "high",
      is_other: false,
    };
  }

  if (
    /лимонад|premium|хонг|honga|мохито|mohito|газированн|сильн.?газир|swipe|лимнад|ретро|чайка|new orange|dreamix/.test(
      blob,
    )
  ) {
    return {
      category: "Газированные напитки",
      category_slug: "gazirovannye-napitki",
      reason: "Лимонад / газированный безалкогольный напиток",
      confidence: "high",
      is_other: false,
    };
  }

  if (/вода|water/.test(blob)) {
    return {
      category: "Питьевая вода",
      category_slug: "voda-pitevaya",
      reason: "Питьевая вода",
      confidence: "medium",
      is_other: false,
    };
  }

  // STM / unclear functional drinks
  return {
    category: options.other.name,
    category_slug: options.other.slug,
    reason: "Неоднозначный официальный тип — в «Другие» для ручного распределения",
    confidence: "low",
    is_other: true,
    create_proposed: options.other.create_proposed,
  };
}

export function product_type_label(category: string, brand: string, blob: string): string {
  if (category === "Питьевая вода") return "Вода питьевая";
  if (category === "Минеральная вода") return "Вода минеральная";
  if (category === "Тоники") return "Тоник";
  if (category === "Энергетические напитки") return "Напиток энергетический";
  if (category === "Холодный чай") return "Холодный чай";
  if (category === "Квас") return "Квас";
  if (category === "Безалкогольное пиво") return "Пиво безалкогольное";
  if (category === "Сокосодержащие напитки") return "Напиток сокосодержащий";
  if (/кола|cola/i.test(blob)) return "Напиток газированный";
  if (category === "Газированные напитки") return "Напиток газированный";
  return `Напиток ${brand}`.trim();
}
