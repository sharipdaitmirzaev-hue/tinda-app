import type { DiscoveredVariant, ExistingCategory } from "./types";

export const DARYAL_CATEGORY_TARGETS = [
  { name: "Газированные напитки", slug: "gazirovannye-napitki" },
  { name: "Питьевая вода", slug: "voda-pitevaya" },
  { name: "Минеральная вода", slug: "voda-mineralnaya" },
  { name: "Сокосодержащие напитки", slug: "sokosoderzhashchie-napitki" },
  { name: "Другие", slug: "other" },
] as const;

export function classify_variant(
  variant: DiscoveredVariant,
  categories: ExistingCategory[],
): {
  category: string;
  category_slug: string;
  category_reason: string;
  exists: boolean;
} {
  const by_slug = new Map(categories.map((c) => [c.slug, c]));

  if (variant.line === "gazirovannye") {
    const slug = "gazirovannye-napitki";
    return {
      category: "Газированные напитки",
      category_slug: slug,
      category_reason: "Линейка сладких газированных напитков «Дарьял»",
      exists: by_slug.has(slug),
    };
  }

  if (variant.line === "water") {
    // Site describes Aqua Daryal as table/artesian mineral drinking water.
    // Prefer mineral if present; else drinking water.
    if (by_slug.has("voda-mineralnaya")) {
      return {
        category: "Минеральная вода",
        category_slug: "voda-mineralnaya",
        category_reason: "Аква Дарьял — природная/столовая минеральная вода",
        exists: true,
      };
    }
    return {
      category: "Питьевая вода",
      category_slug: "voda-pitevaya",
      category_reason: "Аква Дарьял — питьевая артезианская вода",
      exists: by_slug.has("voda-pitevaya"),
    };
  }

  if (variant.line === "juice_still") {
    const slug = "sokosoderzhashchie-napitki";
    if (by_slug.has(slug)) {
      return {
        category: "Сокосодержащие напитки",
        category_slug: slug,
        category_reason: "Фрутимикс с натуральным соком",
        exists: true,
      };
    }
    return {
      category: "Другие",
      category_slug: "other",
      category_reason: "Нет slug sokosoderzhashchie-napitki — fallback other",
      exists: by_slug.has("other"),
    };
  }

  return {
    category: "Другие",
    category_slug: "other",
    category_reason: "Не удалось классифицировать",
    exists: by_slug.has("other"),
  };
}
