import { describe, expect, it } from "vitest";
import {
  assert_apply_flags,
  should_skip_existing,
  validate_backup_file,
} from "../src/lib/imports/aqualania/apply-guards";
import {
  classify_against_production,
  is_distinct_packaging_variant,
  same_identity,
  water_still_and_sparkling_are_distinct,
} from "../src/lib/imports/aqualania/dedupe";
import {
  filter_manifest_products,
  image_mismatch_excluded,
  review_product,
} from "../src/lib/imports/aqualania/review";
import { build_aqualania_sku } from "../src/lib/imports/aqualania/sku";
import type { AquAlaniaProduct } from "../src/lib/imports/aqualania/types";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

function base(
  partial: Partial<AquAlaniaProduct> &
    Pick<AquAlaniaProduct, "line" | "flavor" | "flavor_key" | "package_code" | "volume_ml">,
): AquAlaniaProduct {
  const proposed_sku = build_aqualania_sku({
    line: partial.line,
    flavor_key: partial.flavor_key,
    volume_ml: partial.volume_ml,
    package_code: partial.package_code,
  });
  return {
    official_name: partial.flavor,
    proposed_name: `AquAlania ${partial.flavor}`,
    brand: "AquAlania",
    manufacturer: "ООО «Константа-7»",
    carbonation: "сильногазированная",
    sugar_free: false,
    shelf_life_days: 360,
    source_url: "https://aqualania.ru/product",
    source_image_url: "https://img.creatium.ru/example.png",
    category: "Лимонады",
    category_slug: "limonady",
    category_status: "mapped",
    confidence: "high",
    review_status: "manual",
    image_match_status: "exact",
    duplicate_status: "new_product",
    volume_text: partial.volume_ml === 330 ? "0,33 л" : "0,5 л",
    package_type:
      partial.package_code === "GLASS"
        ? "стекло"
        : partial.package_code === "CAN"
          ? "алюминиевая банка"
          : partial.package_code === "PETCAN"
            ? "ПЭТ-банка"
            : "ПЭТ",
    ...partial,
    proposed_sku,
  };
}

describe("aqualania SKU stability", () => {
  it("builds stable SKUs independent of discovery order", () => {
    const a = build_aqualania_sku({
      line: "PREMIUM",
      flavor_key: "GRUSHA",
      volume_ml: 500,
      package_code: "GLASS",
    });
    const b = build_aqualania_sku({
      line: "PREMIUM",
      flavor_key: "grusha",
      volume_ml: 500,
      package_code: "GLASS",
    });
    expect(a).toBe("AQUALANIA-PREMIUM-GRUSHA-500-GLASS");
    expect(a).toBe(b);
    expect(
      build_aqualania_sku({
        line: "LIGHT",
        flavor_key: "VISHNYA",
        volume_ml: 330,
        package_code: "PETCAN",
      }),
    ).toBe("AQUALANIA-LIGHT-VISHNYA-330-PETCAN");
    expect(
      build_aqualania_sku({
        line: "CAN",
        flavor_key: "MOHITO-CLASSIC",
        volume_ml: 330,
        package_code: "CAN",
      }),
    ).toBe("AQUALANIA-CAN-MOHITO-CLASSIC-330-CAN");
    expect(
      build_aqualania_sku({
        line: "WATER",
        flavor_key: "STILL",
        volume_ml: 500,
        package_code: "PET",
      }),
    ).toBe("AQUALANIA-WATER-STILL-500-PET");
  });
});

describe("aqualania line / package uniqueness", () => {
  it("does not treat different lines of same flavor as duplicates", () => {
    const glass = base({
      line: "PREMIUM",
      flavor: "Дыня-Мята",
      flavor_key: "DYNYA-MYATA",
      volume_ml: 500,
      package_code: "GLASS",
    });
    const can = base({
      line: "CAN",
      flavor: "Дыня-Мята",
      flavor_key: "DYNYA-MYATA",
      volume_ml: 330,
      package_code: "CAN",
    });
    expect(same_identity(glass, can)).toBe(false);
    expect(is_distinct_packaging_variant(glass, can)).toBe(true);
    expect(glass.proposed_sku).not.toBe(can.proposed_sku);
  });

  it("does not treat glass and can as duplicates", () => {
    const glass = base({
      line: "PREMIUM",
      flavor: "Манго-Виноград",
      flavor_key: "MANGO-VINOGRAD",
      volume_ml: 500,
      package_code: "GLASS",
    });
    const can = base({
      line: "CAN",
      flavor: "Манго-Виноград",
      flavor_key: "MANGO-VINOGRAD",
      volume_ml: 330,
      package_code: "CAN",
    });
    expect(same_identity(glass, can)).toBe(false);
  });

  it("marks Light as sugar_free=true", () => {
    const light = base({
      line: "LIGHT",
      flavor: "Вишня",
      flavor_key: "VISHNYA",
      volume_ml: 330,
      package_code: "PETCAN",
      sugar_free: true,
      category: "Газированные напитки",
      category_slug: "gazirovannye-napitki",
    });
    expect(light.sugar_free).toBe(true);
    const reviewed = review_product(light);
    expect(reviewed.review_status).toBe("approved");
  });

  it("treats still and sparkling water as distinct", () => {
    const still = base({
      line: "WATER",
      flavor: "Негазированная",
      flavor_key: "STILL",
      volume_ml: 500,
      package_code: "PET",
      carbonation: "негазированная",
      category: "Негазированная вода",
      category_slug: "voda-negazirovannaya",
    });
    const sparkling = base({
      line: "WATER",
      flavor: "Газированная",
      flavor_key: "SPARKLING",
      volume_ml: 500,
      package_code: "PET",
      carbonation: "газированная",
      category: "Газированная вода",
      category_slug: "voda-gazirovannaya",
    });
    expect(water_still_and_sparkling_are_distinct(still, sparkling)).toBe(true);
    expect(same_identity(still, sparkling)).toBe(false);
    expect(still.proposed_sku).not.toBe(sparkling.proposed_sku);
  });
});

describe("aqualania create-only apply guards", () => {
  it("skips existing products (create-only)", () => {
    expect(should_skip_existing({ sku: "AQUALANIA-PREMIUM-GRUSHA-500-GLASS" })).toBe(true);
    expect(should_skip_existing(null)).toBe(false);
  });

  it("blocks apply without backup and confirmation", () => {
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
        manifest_path: undefined,
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

  it("validates backup file presence", () => {
    const p = path.join(os.tmpdir(), `aqualania-backup-${Date.now()}.sql`);
    writeFileSync(p, "-- PostgreSQL database dump\nCREATE TABLE demo();\n");
    const ok = validate_backup_file(p);
    expect(ok.ok).toBe(true);
    unlinkSync(p);
    expect(validate_backup_file(p).ok).toBe(false);
  });

  it("idempotent skip when SKU already exists in production", () => {
    const status = classify_against_production(
      base({
        line: "PREMIUM",
        flavor: "Груша",
        flavor_key: "GRUSHA",
        volume_ml: 500,
        package_code: "GLASS",
      }),
      [{ sku: "AQUALANIA-PREMIUM-GRUSHA-500-GLASS", name: "existing" }],
    );
    expect(status).toBe("sku_collision");
    expect(should_skip_existing({ sku: "AQUALANIA-PREMIUM-GRUSHA-500-GLASS" })).toBe(true);
  });
});

describe("aqualania review / manifest filters", () => {
  it("excludes image mismatch from auto-approve", () => {
    expect(image_mismatch_excluded("mismatch")).toBe(true);
    expect(image_mismatch_excluded("missing")).toBe(true);
    expect(image_mismatch_excluded("exact")).toBe(false);
    const bad = review_product(
      base({
        line: "PREMIUM",
        flavor: "Груша",
        flavor_key: "GRUSHA",
        volume_ml: 500,
        package_code: "GLASS",
        image_match_status: "missing",
        source_image_url: null,
      }),
    );
    expect(bad.review_status).toBe("rejected");
  });

  it("keeps manual/rejected out of manifest", () => {
    const products = [
      base({
        line: "PREMIUM",
        flavor: "Груша",
        flavor_key: "GRUSHA",
        volume_ml: 500,
        package_code: "GLASS",
        review_status: "approved",
      }),
      base({
        line: "LIGHT",
        flavor: "Вишня",
        flavor_key: "VISHNYA",
        volume_ml: 330,
        package_code: "PETCAN",
        sugar_free: true,
        review_status: "manual",
      }),
      base({
        line: "CAN",
        flavor: "Игристое",
        flavor_key: "IGRISTOE",
        volume_ml: 330,
        package_code: "CAN",
        review_status: "rejected",
      }),
    ];
    const manifest = filter_manifest_products(products);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].proposed_sku).toBe("AQUALANIA-PREMIUM-GRUSHA-500-GLASS");
  });
});
