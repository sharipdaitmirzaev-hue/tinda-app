import { describe, expect, it } from "vitest";
import {
  build_zy_sku,
  dedupe_key,
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
});
