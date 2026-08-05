import { describe, expect, it } from "vitest";
import { classify_variant } from "../src/lib/imports/daryal/classify";
import { build_daryal_name } from "../src/lib/imports/daryal/names";
import {
  parse_sparkling_page,
  parse_still_juice_page,
  parse_water_page,
} from "../src/lib/imports/daryal/parse";
import { build_daryal_sku, sku_slug } from "../src/lib/imports/daryal/sku";

describe("daryal sku", () => {
  it("slugifies cyrillic", () => {
    expect(sku_slug("Кола-апельсин")).toBe("KOLA-APELSIN");
  });

  it("builds sku within 64 chars", () => {
    const sku = build_daryal_sku({
      brand: "Дарьял",
      product_key: "Кола-апельсин",
      volume_ml: 500,
      package: "GLASS",
    });
    expect(sku.startsWith("DARYAL-")).toBe(true);
    expect(sku.endsWith("-500-GLASS")).toBe(true);
    expect(sku.length).toBeLessThanOrEqual(64);
  });
});

describe("daryal parse sparkling", () => {
  it("ignores flavors only present in HTML comments", () => {
    const html = `
      <title>Sparkling</title>
      <h2>СТЕКЛО 0.5 Л.</h2>
      <ul><li>“Тархун”</li></ul>
      <h2>Безалкогольные газированные напитки ПЭТ 0,5л и 1,5л</h2>
      <h3>ПЭТ 0,5</h3>
      <ul>
        <li>“Мохито”</li>
        <!--<li>“Грейпфрут-малина”</li>-->
      </ul>
      <h3>ПЭТ 1,5</h3>
      <ul><li>“Груша”</li></ul>
      <h2>Газированные напитки от ВПБЗ «Дарьял»</h2>
    `;
    const parsed = parse_sparkling_page(html, "https://darialgroup.ru/sparkling/");
    expect(parsed.variants.some((v) => /грейпфрут/i.test(v.taste || ""))).toBe(
      false,
    );
    expect(
      parsed.manual_gaps.some((g) => g.reason === "flavor_in_html_comment_only"),
    ).toBe(true);
  });

  it("extracts glass and pet flavors", () => {
    const html = `
      <title>Sparkling</title>
      <h2>СТЕКЛО 0.5 Л.</h2>
      <ul>
        <li>“Кола-апельсин”</li>
        <li>“Тархун”</li>
        <li>“Груша”</li>
      </ul>
      <h2>Безалкогольные газированные напитки ПЭТ 0,5л и 1,5л</h2>
      <h3>ПЭТ 0,5</h3>
      <ul>
        <li>“Кола-апельсин”</li>
        <li>“Мохито”</li>
      </ul>
      <h3>ПЭТ 1,5</h3>
      <ul>
        <li>“Тархун”</li>
        <li>“Груша”</li>
      </ul>
      <h2>Газированные напитки от ВПБЗ «Дарьял»</h2>
    `;
    const parsed = parse_sparkling_page(html, "https://darialgroup.ru/sparkling/");
    expect(parsed.variants.filter((v) => v.package === "GLASS")).toHaveLength(3);
    expect(parsed.variants.filter((v) => v.package === "PET" && v.volume_ml === 500)).toHaveLength(
      2,
    );
    expect(parsed.variants.filter((v) => v.volume_ml === 1500)).toHaveLength(2);
  });
});

describe("daryal parse water", () => {
  it("creates still and sparkling pack matrix", () => {
    const html = `
      <title>Water</title>
      <p>«Аква Дарьял» негазированная</p>
      <p>СТЕКЛО 0,5Л., ПЭТ 1,5Л., ПЭТ 0,5Л.</p>
      <p>«Аква Дарьял» газированная AQUADARIAL</p>
      <p>СТЕКЛО 0,5Л., ПЭТ 1,5Л., ПЭТ 0,5Л.</p>
    `;
    const parsed = parse_water_page(html, "https://darialgroup.ru/water/");
    expect(parsed.variants).toHaveLength(6);
    expect(parsed.variants.filter((v) => v.carbonation === "негазированная")).toHaveLength(3);
    expect(parsed.variants.filter((v) => v.carbonation === "газированная")).toHaveLength(3);
  });
});

describe("daryal parse frutimix", () => {
  it("marks missing volume as low confidence", () => {
    const html = `
      <title>Still</title>
      <h2>Фрутимикс</h2>
      <p>вкусами : "Мультифрукт" и "Красный апельсин"</p>
    `;
    const parsed = parse_still_juice_page(
      html,
      "https://darialgroup.ru/negazirovannye-napitki/",
    );
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.variants.every((v) => v.volume_ml == null)).toBe(true);
    expect(parsed.manual_gaps.some((g) => g.reason === "missing_volume_package")).toBe(true);
  });
});

describe("daryal classify + names", () => {
  it("maps soda to gazirovannye", () => {
    const cat = classify_variant(
      {
        line: "gazirovannye",
        brand: "Дарьял",
        product_name: "Тархун",
        taste: "Тархун",
        carbonation: "газированная",
        volume_ml: 500,
        volume_text: "0,5 л",
        package: "PET",
        package_label: "ПЭТ",
        source_url: "https://darialgroup.ru/sparkling/",
        source_section: "ПЭТ 0,5",
        image_url: null,
        alcohol_scope: "non_alcoholic",
        confidence: "high",
        notes: "",
      },
      [{ id: "1", name: "Газированные напитки", slug: "gazirovannye-napitki" }],
    );
    expect(cat.category_slug).toBe("gazirovannye-napitki");
    expect(cat.exists).toBe(true);
  });

  it("builds readable name", () => {
    const name = build_daryal_name({
      brand: "Дарьял",
      product_name: "Тархун",
      taste: "Тархун",
      carbonation: "газированная",
      volume_text: "0,5 л",
      package: "GLASS",
    });
    expect(name).toContain("Дарьял");
    expect(name).toContain("0,5 л");
    expect(name).toContain("стекло");
  });
});
