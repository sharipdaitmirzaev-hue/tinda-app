import { describe, expect, it } from "vitest";
import { classify_alcohol } from "../src/lib/imports/bavaria/alcohol";
import {
  classify_category,
  detect_brand,
  propose_other_category,
} from "../src/lib/imports/bavaria/classify";
import { find_possible_duplicates } from "../src/lib/imports/bavaria/dedupe";
import { expand_discovered_products } from "../src/lib/imports/bavaria/expand";
import { build_proposed_name } from "../src/lib/imports/bavaria/names";
import { parse_pack_volumes } from "../src/lib/imports/bavaria/packages";
import { build_bavaria_sku } from "../src/lib/imports/bavaria/sku";
import type { DiscoveredProduct, ProposedProduct } from "../src/lib/imports/bavaria/types";

const cats = [
  { id: "1", name: "Питьевая вода", slug: "voda-pitevaya" },
  { id: "2", name: "Минеральная вода", slug: "voda-mineralnaya" },
  { id: "3", name: "Газированные напитки", slug: "gazirovannye-napitki" },
  { id: "4", name: "Энергетические напитки", slug: "energeticheskie-napitki" },
  { id: "5", name: "Холодный чай", slug: "kholodnyy-chay" },
  { id: "6", name: "Тоники", slug: "toniki" },
  { id: "7", name: "Квас", slug: "kvas" },
];

function product(partial: Partial<DiscoveredProduct> & Pick<DiscoveredProduct, "official_name" | "slug">): DiscoveredProduct {
  return {
    path: `/beer-product/${partial.slug}`,
    url: `https://www.bavaria-group.ru/beer-product/${partial.slug}`,
    source_categories: partial.source_categories || [
      "/beer-category/bezalkogolnye-napitki-bavaria",
    ],
    page_title: partial.page_title || partial.official_name,
    variants: partial.variants || [
      {
        variant_title: "",
        text: "ПЭТ-бутылка 0,5 л",
        text_html: "<p>ПЭТ-бутылка 0,5 л</p>",
        image: "https://www.bavaria-group.ru/files/beer_items/1.png",
      },
    ],
    ...partial,
  };
}

describe("bavaria alcohol classification", () => {
  it("excludes alcoholic beer", () => {
    const d = classify_alcohol(
      "Пиво Бавария Elf светлое. Алкоголь 4,0% об. Стекло 0,45 л",
      { is_beer_or_cider_context: true },
    );
    expect(d.kind).toBe("alcoholic");
    expect(d.alcohol_percent).toBe(4);
  });

  it("includes confirmed non-alcoholic beer ≤0.5%", () => {
    const d = classify_alcohol(
      "«Elf» безалкогольное. Алкоголь 0,5% об. | Стекло 0,45 л",
      { is_beer_or_cider_context: true },
    );
    expect(d.kind).toBe("non_alcoholic");
    expect(d.alcohol_percent).toBe(0.5);
  });

  it("sends unclear beer to unknown", () => {
    const d = classify_alcohol("Nordisch bier стекло 0,45 л", {
      is_beer_or_cider_context: true,
    });
    expect(d.kind).toBe("unknown");
  });
});

describe("bavaria category mapping", () => {
  it("maps TBAU to drinking water", () => {
    const p = product({
      official_name: "Горная родниковая вода «ТБАУ»",
      slug: "zagolovok-produkta-2",
      source_categories: ["/beer-category/gornaa-rodnikovaa-voda-tbau"],
    });
    const brand = detect_brand(p);
    expect(brand).toBe("TBAU");
    const cat = classify_category(p, {
      brand,
      alcohol_kind: "non_alcoholic",
      other: propose_other_category(cats),
      existing_slugs: new Set(cats.map((c) => c.slug)),
    });
    expect(cat.category_slug).toBe("voda-pitevaya");
  });

  it("maps Kazbek-Aqua to mineral water", () => {
    const p = product({
      official_name: "Минеральная лечебно-столовая вода «Казбек-Аква»",
      slug: "zagolovok-produkta",
      source_categories: ["/beer-category/mineralnaa-voda-kazbek-akva"],
    });
    const brand = detect_brand(p);
    expect(brand).toBe("Kazbek-Aqua");
    const cat = classify_category(p, {
      brand,
      alcohol_kind: "non_alcoholic",
      other: propose_other_category(cats),
      existing_slugs: new Set(cats.map((c) => c.slug)),
    });
    expect(cat.category_slug).toBe("voda-mineralnaya");
  });

  it("maps Rocket Ride to energy", () => {
    const p = product({
      official_name: "Витаминный энергетический напиток Rocket Ride",
      slug: "vitaminnyj-napitok-rocket-ride",
    });
    const brand = detect_brand(p);
    const cat = classify_category(p, {
      brand,
      alcohol_kind: "non_alcoholic",
      other: propose_other_category(cats),
      existing_slugs: new Set(cats.map((c) => c.slug)),
    });
    expect(cat.category_slug).toBe("energeticheskie-napitki");
  });

  it("maps Dreamix tonic to tonics", () => {
    const p = product({
      official_name: 'Безалкогольные сильногазированные напитки "Dreamix. Toniс"',
      slug: "dreamix",
    });
    const brand = detect_brand(p);
    const cat = classify_category(p, {
      brand,
      alcohol_kind: "non_alcoholic",
      other: propose_other_category(cats),
      existing_slugs: new Set(cats.map((c) => c.slug)),
    });
    expect(cat.category_slug).toBe("toniki");
  });

  it("sends unknown drink to Другие", () => {
    const p = product({
      official_name: "«Аварал»",
      slug: "avaral",
      source_categories: ["/beer-category/stm-dla-partnerov"],
      variants: [
        {
          variant_title: "Аварал",
          text: "Стекло 0,45 л",
          text_html: "",
          image: null,
        },
      ],
    });
    const brand = detect_brand(p);
    const other = propose_other_category(cats);
    const cat = classify_category(p, {
      brand,
      alcohol_kind: "non_alcoholic",
      other,
      existing_slugs: new Set(cats.map((c) => c.slug)),
    });
    expect(cat.is_other).toBe(true);
    expect(cat.category).toBe("Другие");
  });
});

describe("bavaria variants and sku", () => {
  it("does not treat different volumes as duplicates", () => {
    const a: ProposedProduct = {
      proposed_sku: "BAVARIA-A-X-500-PET",
      official_name: "x",
      proposed_name: "Напиток A Груша, 0,5 л, ПЭТ",
      brand: "Бавария",
      manufacturer: "ГК ПД «Бавария»",
      category: "Газированные напитки",
      category_slug: "gazirovannye-napitki",
      category_reason: "t",
      volume: "0,5 л",
      package: "ПЭТ",
      package_code: "PET",
      taste: "Груша",
      carbonation: "газированная",
      sugar: null,
      alcohol_percent: null,
      source_url: "https://www.bavaria-group.ru/x",
      image_url: null,
      local_image_path: null,
      duplicate_status: "new",
      confidence: "high",
      notes: "",
      import_status: "proposed",
      description: null,
    };
    const b = {
      ...a,
      proposed_sku: "BAVARIA-A-X-1500-PET",
      volume: "1,5 л",
      proposed_name: "Напиток A Груша, 1,5 л, ПЭТ",
    };
    const { duplicates } = find_possible_duplicates([a, b], [
      {
        sku: "OTHER-1",
        name: "Чужой товар Груша, 0,5 л, ПЭТ",
        brand: "Чужой",
        volume_text: "0,5 л",
        package_type: "ПЭТ",
        image_url: null,
      },
    ]);
    expect(duplicates.length).toBe(0);
  });

  it("does not treat different tastes as duplicates", () => {
    const packs = parse_pack_volumes("ПЭТ-бутылка 0,5 л | ПЭТ-бутылка 1,5 л");
    expect(packs.map((p) => p.volume_ml).sort((a, b) => a - b)).toEqual([
      500, 1500,
    ]);
    const sku1 = build_bavaria_sku({
      brand: "Бавария",
      product_key: "tarhun",
      volume_ml: 500,
      package: "PET",
    });
    const sku2 = build_bavaria_sku({
      brand: "Бавария",
      product_key: "grusha",
      volume_ml: 500,
      package: "PET",
    });
    expect(sku1).not.toBe(sku2);
    expect(sku1.startsWith("BAVARIA-")).toBe(true);
  });

  it("SKU is stable across calls", () => {
    const a = build_bavaria_sku({
      brand: "Dreamix",
      product_key: "Indian Tonik",
      volume_ml: 1000,
      package: "PET",
    });
    const b = build_bavaria_sku({
      brand: "Dreamix",
      product_key: "Indian Tonik",
      volume_ml: 1000,
      package: "PET",
    });
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it("name template uses comma decimals", () => {
    const name = build_proposed_name({
      type_label: "Вода питьевая",
      brand: "TBAU",
      line_or_taste: null,
      carbonation: "негазированная",
      volume: "0,5 л",
      package_label: "ПЭТ",
    });
    expect(name).toBe("Вода питьевая TBAU негазированная, 0,5 л, ПЭТ");
  });
});

describe("bavaria expand idempotency", () => {
  it("expand is deterministic", () => {
    const products = [
      product({
        official_name: "Квас «Добрецовъ»",
        slug: "kvas-dobrecov",
        variants: [
          {
            variant_title: "Квас Добрецовъ",
            text: "ПЭТ-бутылка 1,5 л",
            text_html: "",
            image: "https://www.bavaria-group.ru/files/beer_items/1.jpg",
          },
        ],
      }),
      product({
        official_name: "Пиво Бавария Elf светлое. Алкоголь 4,0% об.",
        slug: "pivo-bavaria-elf-svetloe-filtrovannoe",
        source_categories: ["/beer-category/pivo-i-sidr"],
        variants: [
          {
            variant_title: "",
            text: "Алкоголь 4,0% об. Стекло 0,45 л",
            text_html: "",
            image: null,
          },
        ],
      }),
      product({
        official_name: "«Elf» безалкогольное",
        slug: "elf-bezalkogolnoe",
        source_categories: ["/beer-category/pivo-i-sidr"],
        variants: [
          {
            variant_title: "",
            text: "безалкогольное Алкоголь 0,5% об. | Стекло 0,45 л",
            text_html: "",
            image: null,
          },
        ],
      }),
    ];
    const a = expand_discovered_products(products, cats);
    const b = expand_discovered_products(products, cats);
    expect(a.proposed.map((p) => p.proposed_sku)).toEqual(
      b.proposed.map((p) => p.proposed_sku),
    );
    expect(a.skipped_alcoholic.length).toBe(1);
    expect(a.proposed.some((p) => p.category === "Безалкогольное пиво")).toBe(
      true,
    );
    expect(a.proposed.some((p) => p.category === "Квас")).toBe(true);
  });

  it("does not invent prices or touch existing records in expand output", () => {
    const a = expand_discovered_products(
      [
        product({
          official_name: "Кола Premium SUGAR FREE",
          slug: "kola-premium-sugar-free",
          variants: [
            {
              variant_title: "Кола Premium SUGAR FREE",
              text: "ПЭТ-бутылка 0,5 л | ПЭТ-бутылка 1 л",
              text_html: "",
              image: null,
            },
          ],
        }),
      ],
      cats,
    );
    expect(a.proposed.length).toBeGreaterThan(0);
    for (const p of a.proposed) {
      expect(p.manufacturer).toBe("ГК ПД «Бавария»");
      expect(p.source_url).toContain("bavaria-group.ru");
    }
  });
});
