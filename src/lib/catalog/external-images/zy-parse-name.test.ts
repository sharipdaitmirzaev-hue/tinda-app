import { describe, expect, it } from "vitest";
import {
  build_zy_sku,
  detect_explicit_juice_package,
  infer_juice_package,
  parse_zy_product_name,
} from "@/lib/catalog/external-images/zy-parse-name";

describe("parse_zy_product_name", () => {
  it("parses Dobry cola pet", () => {
    const p = parse_zy_product_name("Напиток Добрый Кола пэт 0,5л Зеро");
    expect(p.brand).toBe("Добрый");
    expect(p.volume_ml).toBe(500);
    expect(p.package_code).toBe("PET");
    expect(p.sugar_free).toBe(true);
  });

  it("parses can package ж/б", () => {
    const p = parse_zy_product_name("Напиток газированный KINZA кола ZERO ж/б 320мл");
    expect(p.brand).toBe("KINZA");
    expect(p.volume_ml).toBe(320);
    expect(p.package_code).toBe("CAN");
    expect(p.sugar_free).toBe(true);
  });

  it("builds latin-only temporary SKU", () => {
    const sku = build_zy_sku("Добрый", 1000, "PET", 1);
    expect(sku).toMatch(/^ZY-[A-Z0-9]+-1000-PET-001$/);
  });

  it("parses volume shorthand without unit before package", () => {
    const p = parse_zy_product_name("Напиток газир Боржоми Груша 0,33 ж/б");
    expect(p.volume_ml).toBe(330);
    expect(p.package_code).toBe("CAN");
    expect(p.brand).toBe("Боржоми");
  });

  it("fixes retail typo 0,33мл as 330 ml", () => {
    const p = parse_zy_product_name("Напиток SWAG! ст/б 0,33мл Слива");
    expect(p.volume_ml).toBe(330);
    expect(p.package_code).toBe("GLASS");
  });

  it("detects tetra/carton from name", () => {
    const p = parse_zy_product_name("Нектар Добрый 1л Мультифрукт тетрапак");
    expect(p.package_code).toBe("CARTON");
  });
});

describe("infer_juice_package", () => {
  it("maps tetra synonyms to carton", () => {
    expect(detect_explicit_juice_package("сок в tetra pak")).toBe("carton");
    expect(detect_explicit_juice_package("Pure-Pak 1л")).toBe("carton");
  });

  it("infers carton for Dobry 1L nectar without package marker", () => {
    const r = infer_juice_package({
      source_name: "Нектар Добрый 1л Мультифрукт",
      brand: "Добрый",
      volume_ml: 1000,
      product_type: "nectar",
    });
    expect(r.package_type).toBe("carton");
    expect(r.package_code).toBe("CARTON");
    expect(r.source).toBe("brand_volume_heuristic");
  });

  it("keeps glass explicit marker", () => {
    const r = infer_juice_package({
      source_name: "Сок Ириб ст/б 0,75л Гранатовый",
      brand: "Ириб",
      volume_ml: 750,
      product_type: "juice",
    });
    expect(r.package_type).toBe("glass");
    expect(r.source).toBe("name_explicit");
  });

  it("does not treat transport box as unit package", () => {
    expect(detect_explicit_juice_package("коробка 12 шт")).toBe("unknown");
  });
});
