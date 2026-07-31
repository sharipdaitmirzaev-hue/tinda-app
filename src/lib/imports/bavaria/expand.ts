import {
  classify_alcohol,
  is_beer_category_path,
} from "./alcohol";
import {
  MANUFACTURER,
  classify_category,
  detect_brand,
  product_type_label,
  propose_other_category,
} from "./classify";
import { build_proposed_name } from "./names";
import {
  detect_carbonation,
  detect_sugar,
  package_label,
  parse_pack_volumes,
  parse_taste_list,
} from "./packages";
import { build_bavaria_sku } from "./sku";
import type {
  DiscoveredProduct,
  ExistingCategory,
  ManualReviewItem,
  ParsedPackVolume,
  ProposedProduct,
  SkippedAlcoholicItem,
} from "./types";

type ExpandResult = {
  proposed: ProposedProduct[];
  manual_review: ManualReviewItem[];
  skipped_alcoholic: SkippedAlcoholicItem[];
  category_rows: Array<{
    product: string;
    official_type: string;
    category: string;
    reason: string;
    confidence: string;
    is_other: boolean;
  }>;
};

function unique_tastes(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.toLowerCase().replace(/ё/g, "е");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Official TBAU volumes from tbau.ru (linked from manufacturer). */
function tbau_official_packs(
  kind: "classic" | "premium" | "detskaya" | "cooler",
): ParsedPackVolume[] {
  const vol = (ml: number) => normalize_volume_display(ml);
  const pet = (ml: number): ParsedPackVolume => ({
    volume_ml: ml,
    volume_text: vol(ml),
    package: "PET",
    package_label: "ПЭТ",
  });
  const glass = (ml: number): ParsedPackVolume => ({
    volume_ml: ml,
    volume_text: vol(ml),
    package: "GLASS",
    package_label: "стекло",
  });

  if (kind === "premium") {
    return [glass(330), glass(450), glass(500)];
  }
  if (kind === "detskaya") {
    return [pet(330), pet(500), pet(1500), pet(5000)];
  }
  if (kind === "cooler") {
    return [pet(19000)];
  }
  return [pet(500), pet(1000), pet(1500), pet(5000), pet(19000)];
}

function normalize_volume_display(ml: number): string {
  if (ml >= 1000) {
    const liters = ml / 1000;
    return `${String(liters).replace(".", ",")} л`;
  }
  // Prefer liter notation for typical bottle sizes (0,33 л / 0,45 л / 0,5 л).
  if (ml % 10 === 0) {
    const liters = ml / 1000;
    return `${String(liters).replace(".", ",")} л`;
  }
  return `${ml} мл`;
}

function fix_pack_volume_text(p: ParsedPackVolume): ParsedPackVolume {
  return { ...p, volume_text: normalize_volume_display(p.volume_ml) };
}

function extract_hongae_tastes(title: string, text: string): string[] {
  const blob = `${title} ${text}`;
  if (/ежевика|черешня|виноград|шелковица/i.test(blob)) {
    return unique_tastes(
      blob
        .split(/[|/]/)
        .map((t) => t.trim())
        .filter((t) =>
          /ежевика|черешня|виноград|яблоко|шелковица/i.test(t),
        )
        .map((t) => t.replace(/\s+/g, " ")),
    );
  }
  return parse_taste_list(blob);
}

function expand_packs_from_variant(
  product: DiscoveredProduct,
  variant_text: string,
): ParsedPackVolume[] {
  const parsed = parse_pack_volumes(variant_text).map(fix_pack_volume_text);
  if (parsed.length) return parsed;

  // TBAU enrichment from official brand site volumes when page lists assortment only.
  if (/tbau|тбау/i.test(product.official_name + product.slug)) {
    if (/детск/i.test(product.official_name + product.slug)) {
      return tbau_official_packs("detskaya");
    }
    if (/кулер/i.test(product.official_name + product.slug)) {
      return tbau_official_packs("cooler");
    }
    if (/premium/i.test(variant_text)) {
      return tbau_official_packs("premium");
    }
  }
  return [];
}

function carbonations_for_tbau(text: string): Array<"газированная" | "негазированная" | null> {
  const has_both =
    /газированн/i.test(text) && /негазированн/i.test(text);
  if (has_both) return ["газированная", "негазированная"];
  const one = detect_carbonation(text);
  return [one];
}

export function expand_discovered_products(
  products: DiscoveredProduct[],
  existing_categories: ExistingCategory[],
): ExpandResult {
  const other = propose_other_category(existing_categories);
  const existing_slugs = new Set(existing_categories.map((c) => c.slug));
  const proposed: ProposedProduct[] = [];
  const manual_review: ManualReviewItem[] = [];
  const skipped_alcoholic: SkippedAlcoholicItem[] = [];
  const category_rows: ExpandResult["category_rows"] = [];
  const sku_seen = new Set<string>();

  for (const product of products) {
    const beer_ctx = is_beer_category_path(product.source_categories);
    const page_blob = [
      product.official_name,
      product.page_title,
      ...product.variants.map((v) => `${v.variant_title} ${v.text}`),
    ].join("\n");

    const alcohol = classify_alcohol(page_blob, {
      is_beer_or_cider_context: beer_ctx,
    });

    if (alcohol.kind === "alcoholic") {
      skipped_alcoholic.push({
        name: product.official_name,
        brand: detect_brand(product),
        alcohol_percent: alcohol.alcohol_percent,
        url: product.url,
        reason: alcohol.evidence,
      });
      continue;
    }

    if (alcohol.kind === "unknown") {
      manual_review.push({
        official_name: product.official_name,
        brand: detect_brand(product),
        source_url: product.url,
        reason: "Нельзя надёжно определить алкогольный статус",
        evidence: alcohol.evidence,
        suggested_action: "Проверить карточку/этикетку вручную; не импортировать автоматически",
      });
      continue;
    }

    // Skip non-beverage STM noise? Keep STM drinks.
    if (/чипсы|картош|ресторан|экскур/i.test(product.official_name)) {
      manual_review.push({
        official_name: product.official_name,
        brand: detect_brand(product),
        source_url: product.url,
        reason: "Не похоже на напиток",
        evidence: product.official_name,
        suggested_action: "Исключить из ассортимента напитков",
      });
      continue;
    }

    const brand = detect_brand(product);
    const cat = classify_category(product, {
      brand,
      alcohol_kind: alcohol.kind,
      other,
      existing_slugs,
    });

    category_rows.push({
      product: product.official_name,
      official_type: product.official_name,
      category: cat.category,
      reason: cat.reason,
      confidence: cat.confidence,
      is_other: cat.is_other,
    });

    const type_label = product_type_label(
      cat.category,
      brand,
      page_blob,
    );

    // Special: TBAU main assortment page — expand lines × packs × carbonation.
    if (product.slug === "zagolovok-produkta-2") {
      const lines: Array<{
        taste: string | null;
        packs: ParsedPackVolume[];
        carbons: Array<"газированная" | "негазированная" | null>;
        source_note: string;
      }> = [
        {
          taste: null,
          packs: tbau_official_packs("classic"),
          carbons: ["газированная", "негазированная"],
          source_note: "TBAU PET объёмы с tbau.ru/catalog/pet + газир./негазир. с карточки bavaria-group",
        },
        {
          taste: "Premium",
          packs: tbau_official_packs("premium"),
          carbons: ["газированная", "негазированная"],
          source_note: "TBAU Premium объёмы с tbau.ru/catalog/tbau-premium-voda",
        },
      ];

      for (const line of lines) {
        for (const pack of line.packs) {
          for (const carbonation of line.carbons) {
            push_proposed({
              product,
              brand,
              cat,
              type_label,
              taste: line.taste,
              pack,
              carbonation,
              sugar: null,
              alcohol_percent: null,
              image_url: product.variants[0]?.image ?? null,
              description: product.variants[0]?.text ?? null,
              notes: line.source_note,
              confidence: "high",
              product_key: `${line.taste ?? "classic"}-${carbonation ?? "na"}`,
            });
          }
        }
      }

      manual_review.push({
        official_name: "Горная родниковая вода «ТБАУ» Sport",
        brand: "TBAU",
        source_url: product.url,
        reason:
          "Линейка Sport упомянута на карточке, но точные объёмы/газированность для Sport не разложены отдельно без догадок",
        evidence: product.variants[0]?.text?.slice(0, 240) || "",
        suggested_action:
          "Уточнить фасовки Sport на tbau.ru / этикетке и добавить вручную",
      });
      continue;
    }

    for (let vi = 0; vi < product.variants.length; vi += 1) {
      const variant = product.variants[vi];
      const vblob = `${variant.variant_title}\n${variant.text}`;
      let tastes = unique_tastes([
        ...extract_hongae_tastes(variant.variant_title, variant.text),
        ...parse_taste_list(vblob),
      ]);

      // Variant title as single taste when not an assortment list.
      if (
        !tastes.length &&
        variant.variant_title &&
        !/ассортимент/i.test(variant.variant_title) &&
        !/[|/]/.test(variant.variant_title)
      ) {
        tastes = [variant.variant_title.trim()];
      }

      // Strip brand prefixes from rocket titles etc.
      tastes = tastes.map((t) =>
        t
          .replace(/^Rocket Ride\s+/i, "")
          .replace(/^Dreamix\s+/i, "")
          .replace(/^MOUNTEA\s+/i, "")
          .trim(),
      );

      let packs = expand_packs_from_variant(product, vblob);
      if (!packs.length && /формат\s*0[,.]5/i.test(vblob)) {
        packs = [
          fix_pack_volume_text({
            volume_ml: 500,
            volume_text: "0,5 л",
            package: "PET",
            package_label: "ПЭТ",
          }),
        ];
      }

      // Rocket Ride / energy without volume → manual review
      if (!packs.length) {
        manual_review.push({
          official_name: `${product.official_name}${
            variant.variant_title ? ` / ${variant.variant_title}` : ""
          }`,
          brand,
          source_url: product.url,
          reason: "Не указаны объём и/или тара на официальной карточке",
          evidence: vblob.slice(0, 240),
          suggested_action:
            "Уточнить фасовку по этикетке/прайсу производителя, затем добавить вручную",
        });
        continue;
      }

      if (!tastes.length) {
        // Multiple image variants without titles:
        // - for NA beer / water with only package shots → treat as same SKU line (taste=null), dedupe packs later
        // - for flavored soft drinks → keep distinct by image id and flag for manual naming
        const looks_like_pack_shots_only =
          cat.category === "Безалкогольное пиво" ||
          cat.category === "Питьевая вода" ||
          cat.category === "Минеральная вода";

        if (
          product.variants.length > 1 &&
          !variant.variant_title &&
          !looks_like_pack_shots_only
        ) {
          const img_id =
            (variant.image || "").match(/beer_items\/(\d+)/)?.[1] ||
            String(vi + 1);
          tastes = [`вариант ${img_id}`];
          manual_review.push({
            official_name: product.official_name,
            brand,
            source_url: product.url,
            reason: `Вкус не подписан в карточке (изображение ${img_id})`,
            evidence: "Пустой title у slider item",
            suggested_action: "Задать официальное название вкуса перед apply",
          });
        } else if (cat.category === "Безалкогольное пиво") {
          const line =
            product.official_name
              .replace(/[«»"]/g, "")
              .replace(/\s*безалкогольное.*/i, "")
              .trim() || product.slug;
          tastes = [line];
        } else {
          tastes = [null as unknown as string];
        }
      }

      const carbons =
        brand === "TBAU" || /негазир/i.test(vblob)
          ? carbonations_for_tbau(vblob)
          : [detect_carbonation(`${product.official_name} ${vblob}`)];

      const sugar = detect_sugar(`${product.official_name} ${vblob}`);

      for (const taste of tastes) {
        for (const pack of packs) {
          for (const carbonation of carbons) {
            const taste_value = taste || null;
            push_proposed({
              product,
              brand,
              cat,
              type_label,
              taste: taste_value,
              pack,
              carbonation,
              sugar,
              alcohol_percent: alcohol.alcohol_percent,
              image_url: variant.image,
              description: variant.text || null,
              notes: cat.is_other
                ? "Категория «Другие» — требуется ручная перекладка"
                : taste_value?.startsWith("вариант ")
                  ? "Вкус без официальной подписи — см. manual-review"
                  : "",
              confidence:
                cat.confidence === "low" || taste_value?.startsWith("вариант ")
                  ? "low"
                  : cat.confidence,
              product_key: [
                taste_value || product.slug,
                carbonation || "",
                sugar || "",
              ]
                .filter(Boolean)
                .join("-"),
              import_status: taste_value?.startsWith("вариант ")
                ? "manual_review"
                : "proposed",
            });
          }
        }
      }
    }
  }

  function push_proposed(args: {
    product: DiscoveredProduct;
    brand: string;
    cat: ReturnType<typeof classify_category>;
    type_label: string;
    taste: string | null;
    pack: ParsedPackVolume;
    carbonation: "газированная" | "негазированная" | null;
    sugar: "с сахаром" | "без сахара" | null;
    alcohol_percent: number | null;
    image_url: string | null;
    description: string | null;
    notes: string;
    confidence: "high" | "medium" | "low";
    product_key: string;
    import_status?: "proposed" | "manual_review";
  }) {
    // Default package for «Формат 0,5 л» without type: PET for sodas.
    let pack = args.pack;
    if (pack.package === "OTHER") {
      pack = {
        ...pack,
        package: "PET",
        package_label: package_label("PET"),
      };
    }

    const proposed_name = build_proposed_name({
      type_label: args.type_label,
      brand: args.brand,
      line_or_taste: args.taste,
      carbonation: args.carbonation,
      volume: pack.volume_text,
      package_label: pack.package_label,
    });

    let proposed_sku = build_bavaria_sku({
      brand: args.brand,
      product_key: args.product_key,
      volume_ml: pack.volume_ml,
      package: pack.package,
    });

    if (sku_seen.has(proposed_sku)) {
      // Same identity already added (e.g. duplicate pack shots) — skip.
      if (
        proposed.some(
          (p) =>
            p.volume === pack.volume_text &&
            p.package_code === pack.package &&
            (p.taste || "") === (args.taste || "") &&
            p.brand === args.brand &&
            (p.carbonation || "") === (args.carbonation || "") &&
            (p.sugar || "") === (args.sugar || ""),
        )
      ) {
        return;
      }

      // Disambiguate deterministically from taste/name.
      proposed_sku = build_bavaria_sku({
        brand: args.brand,
        product_key: `${args.product_key}-${proposed_name}`,
        volume_ml: pack.volume_ml,
        package: pack.package,
      });
      let n = 2;
      while (sku_seen.has(proposed_sku) && n < 10) {
        proposed_sku = build_bavaria_sku({
          brand: args.brand,
          product_key: `${args.product_key}-v${n}`,
          volume_ml: pack.volume_ml,
          package: pack.package,
        });
        n += 1;
      }
      if (sku_seen.has(proposed_sku)) {
        manual_review.push({
          official_name: proposed_name,
          brand: args.brand,
          source_url: args.product.url,
          reason: `Конфликт SKU ${proposed_sku}`,
          evidence: proposed_name,
          suggested_action: "Разрешить коллизию SKU вручную",
        });
        return;
      }
    }

    sku_seen.add(proposed_sku);
    proposed.push({
      proposed_sku,
      official_name: args.product.official_name,
      proposed_name,
      brand: args.brand,
      manufacturer: MANUFACTURER,
      category: args.cat.category,
      category_slug: args.cat.category_slug,
      category_reason: args.cat.reason,
      volume: pack.volume_text,
      package: pack.package_label,
      package_code: pack.package,
      taste: args.taste,
      carbonation: args.carbonation,
      sugar: args.sugar,
      alcohol_percent: args.alcohol_percent,
      source_url: args.product.url,
      image_url: args.image_url,
      local_image_path: null,
      duplicate_status: "new",
      confidence: args.confidence,
      notes: args.notes,
      import_status: args.import_status || "proposed",
      description: args.description,
    });
  }

  return { proposed, manual_review, skipped_alcoholic, category_rows };
}
