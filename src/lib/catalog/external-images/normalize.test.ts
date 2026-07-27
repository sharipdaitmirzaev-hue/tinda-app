import { describe, expect, it } from "vitest";
import {
  normalize_brand,
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
} from "@/lib/catalog/external-images/normalize";
import {
  replacement_priority_for_product,
  should_auto_prepare_replacement,
} from "@/lib/catalog/external-images/replacement-priority";

describe("normalize", () => {
  it("parses volumes in liters and ml", () => {
    expect(parse_volume_ml("0.33 л")).toBe(330);
    expect(parse_volume_ml("0,5л")).toBe(500);
    expect(parse_volume_ml("330 мл")).toBe(330);
  });

  it("normalizes package aliases", () => {
    expect(normalize_package("ж/б банка")).toBe("can");
    expect(normalize_package("ПЭТ")).toBe("pet");
    expect(normalize_package("стекло")).toBe("glass");
  });

  it("detects sugar-free variants", () => {
    expect(sugar_free_flag("Coca-Cola Zero")).toBe(true);
    expect(sugar_free_flag("Coca-Cola Classic")).toBe(false);
  });

  it("normalizes brand spelling", () => {
    expect(normalize_brand("Coca-Cola")).toBe("cocacola");
    expect(normalize_brand("Кока-Кола")).toBe("kokakola");
  });
});

describe("replacement_priority", () => {
  it("prioritizes missing photo first", () => {
    const r = replacement_priority_for_product({
      id: "1",
      sku: "A",
      name: "A",
      brand: "A",
      volume_text: "1 л",
      package_type: "pet",
      image_url: null,
    });
    expect(r.priority).toBe(1);
  });

  it("auto-prepares only exact_match without watermark", () => {
    expect(should_auto_prepare_replacement("exact_match", true, null)).toBe(
      true,
    );
    expect(should_auto_prepare_replacement("probable_match", true, null)).toBe(
      false,
    );
    expect(should_auto_prepare_replacement("exact_match", true, true)).toBe(
      false,
    );
  });
});
