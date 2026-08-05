import { describe, expect, it } from "vitest";
import {
  assert_apply_flags,
  should_skip_existing,
  validate_backup_file,
} from "../src/lib/imports/irib/apply-guards";
import { classify_against_production, same_identity } from "../src/lib/imports/irib/dedupe";
import { filter_manifest_products, review_product } from "../src/lib/imports/irib/review";
import { build_irib_sku } from "../src/lib/imports/irib/sku";
import type { IribProduct } from "../src/lib/imports/irib/types";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

function base(
  partial: Partial<IribProduct> &
    Pick<IribProduct, "line" | "flavor" | "flavor_key" | "package_code" | "volume_ml">,
): IribProduct {
  const proposed_sku = build_irib_sku({
    line: partial.line,
    flavor_key: partial.flavor_key,
    volume_ml: partial.volume_ml,
    package_code: partial.package_code,
  });
  return {
    official_name: partial.flavor,
    proposed_name: `Ириб ${partial.flavor}`,
    brand: "Ириб",
    manufacturer: "ООО «ИРИБ»",
    carbonation: null,
    source_url: "https://irib.su/product/example/",
    source_image_url: "https://irib.su/wp-content/uploads/example.png",
    category: "Нектар",
    category_slug: "nektar",
    category_status: "mapped",
    confidence: "high",
    review_status: "manual",
    image_match_status: "exact",
    duplicate_status: "new_product",
    volume_text: `${partial.volume_ml} мл`,
    package_type: partial.package_code === "GLASS" ? "стекло" : "ПЭТ",
    ...partial,
    proposed_sku,
  };
}

describe("irib SKU stability", () => {
  it("builds stable SKUs independent of discovery order", () => {
    const a = build_irib_sku({
      line: "NEKTAR",
      flavor_key: "ABRIKOS",
      volume_ml: 750,
      package_code: "GLASS",
    });
    const b = build_irib_sku({
      line: "nektar",
      flavor_key: "абрикос",
      volume_ml: 750,
      package_code: "GLASS",
    });
    expect(a).toBe("IRIB-NEKTAR-ABRIKOS-750-GLASS");
    expect(a).toBe(b);
    expect(
      build_irib_sku({
        line: "BRO-LEMON",
        flavor_key: "COLA",
        volume_ml: 500,
        package_code: "PET",
      }),
    ).toBe("IRIB-BRO-LEMON-COLA-500-PET");
    expect(
      build_irib_sku({
        line: "ICE-BAR",
        flavor_key: "PERSIK",
        volume_ml: 500,
        package_code: "PET",
      }),
    ).toBe("IRIB-ICE-BAR-PERSIK-500-PET");
  });
});

describe("irib identity / packaging", () => {
  it("treats flavor×volume×package as distinct SKUs", () => {
    const glass = base({
      line: "MINDARI",
      flavor: "Груша",
      flavor_key: "GRUSHA",
      volume_ml: 500,
      package_code: "GLASS",
      brand: "Mindari",
      category: "Лимонады",
      category_slug: "limonady",
    });
    const pet = base({
      line: "LIMONAD-PET",
      flavor: "Груша",
      flavor_key: "GRUSHA",
      volume_ml: 500,
      package_code: "PET",
      category: "Лимонады",
      category_slug: "limonady",
    });
    expect(same_identity(glass, pet)).toBe(false);
    expect(glass.proposed_sku).not.toBe(pet.proposed_sku);
  });
});

describe("irib production dedupe", () => {
  it("flags exact match against existing ZY-IRIB juice", () => {
    const p = base({
      line: "SOK",
      flavor: "Яблочный",
      flavor_key: "YABLOCHNYJ",
      volume_ml: 750,
      package_code: "GLASS",
      category: "Сок",
      category_slug: "sok",
    });
    const status = classify_against_production(p, [
      {
        sku: "ZY-IRIB-750-GLASS-005",
        name: "Сок Ириб ст/б 0,75л Яблочный 100%",
        brand: "Ириб",
        volume_text: "750 мл",
        package_type: "стекло",
      },
    ]);
    expect(status).toBe("exact_match");
  });

  it("keeps unrelated production brands as new_product", () => {
    const p = base({
      line: "GOLD-GRAND",
      flavor: "Тархун",
      flavor_key: "TARHUN",
      volume_ml: 600,
      package_code: "PET",
      brand: "GOLD GRAND",
      category: "Лимонады",
      category_slug: "limonady",
    });
    expect(
      classify_against_production(p, [
        { sku: "AQUALANIA-PREMIUM-TARHUN-500-GLASS", name: "AquAlania Тархун", brand: "AquAlania" },
      ]),
    ).toBe("new_product");
  });

  it("does not match Selesta lemonade to Ириб juice by shared fruit word", () => {
    const p = base({
      line: "SELESTA",
      flavor: "Ананас",
      flavor_key: "ANANAS",
      volume_ml: 500,
      package_code: "GLASS",
      brand: "Selesta",
      category: "Лимонады",
      category_slug: "limonady",
    });
    expect(
      classify_against_production(p, [
        {
          sku: "ZY-IRIB-750-GLASS-009",
          name: "Сок Ириб ст/б 0,75л Ананасовый 100%",
          brand: "Ириб",
          volume_text: "750 мл",
          package_type: "стекло",
        },
      ]),
    ).toBe("new_product");
  });

  it("flags Тарки-Тау against existing production mineral water", () => {
    const p = base({
      line: "TARKI-TAU",
      flavor: "Тарки-Тау",
      flavor_key: "TARKI-TAU",
      volume_ml: 500,
      package_code: "GLASS",
      brand: "Тарки-Тау",
      category: "Газированная вода",
      category_slug: "voda-gazirovannaya",
      package_type: "стекло",
    });
    expect(
      classify_against_production(p, [
        {
          sku: "ZY-IRIB-500-GLASS-001",
          name: "Вода Ириб минер Тарки Тау ст/б 0,5л",
          brand: "Ириб",
          volume_text: "500 мл",
          package_type: "стекло",
        },
      ]),
    ).toBe("exact_match");
  });
});

describe("irib review buckets", () => {
  it("approves clean new SKUs with mapped category and image", () => {
    const p = base({
      line: "GOLD-GRAND",
      flavor: "Ананас",
      flavor_key: "ANANAS",
      volume_ml: 600,
      package_code: "PET",
      brand: "GOLD GRAND",
      category: "Лимонады",
      category_slug: "limonady",
      duplicate_status: "new_product",
      image_match_status: "exact_low_res",
    });
    const r = review_product(p);
    expect(r.review_status).toBe("approved");
  });

  it("sends production collisions to manual", () => {
    const p = base({
      line: "NEKTAR",
      flavor: "Абрикосовый",
      flavor_key: "ABRIKOSOVYJ",
      volume_ml: 750,
      package_code: "GLASS",
      duplicate_status: "exact_match",
    });
    expect(review_product(p).review_status).toBe("manual");
  });

  it("manifest filter keeps only approved", () => {
    const rows = [
      { review_status: "approved" as const },
      { review_status: "manual" as const },
      { review_status: "rejected" as const },
    ];
    expect(filter_manifest_products(rows)).toHaveLength(1);
  });
});

describe("irib apply guards", () => {
  it("blocks apply without confirmation/backup/manifest and forbids merge", () => {
    expect(
      assert_apply_flags({
        confirmed: false,
        backup_path: "/tmp/x.sql",
        manifest_path: "/tmp/m.json",
        merge: false,
      }).ok,
    ).toBe(false);
    expect(
      assert_apply_flags({
        confirmed: true,
        backup_path: undefined,
        manifest_path: "/tmp/m.json",
        merge: false,
      }).ok,
    ).toBe(false);
    expect(
      assert_apply_flags({
        confirmed: true,
        backup_path: "/tmp/x.sql",
        manifest_path: "/tmp/m.json",
        merge: true,
      }).ok,
    ).toBe(false);
    expect(
      assert_apply_flags({
        confirmed: true,
        backup_path: "/tmp/x.sql",
        manifest_path: "/tmp/m.json",
        merge: false,
      }).ok,
    ).toBe(true);
  });

  it("validates backup file and skips existing SKUs (create-only)", () => {
    const tmp = path.join(os.tmpdir(), `irib-backup-${Date.now()}.sql`);
    writeFileSync(tmp, "-- PostgreSQL database dump\nCREATE TABLE t(id int);\n");
    const v = validate_backup_file(tmp);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.backup_sha256).toHaveLength(64);
    unlinkSync(tmp);
    expect(should_skip_existing({ sku: "IRIB-NEKTAR-ABRIKOS-750-GLASS" })).toBe(true);
    expect(should_skip_existing(null)).toBe(false);
  });
});
