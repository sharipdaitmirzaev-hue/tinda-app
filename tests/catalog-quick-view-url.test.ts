import { describe, expect, it } from "vitest";
import {
  buildCatalogHrefWithQuickView,
  QUICK_VIEW_PARAM,
  readQuickViewId,
} from "@/lib/catalog/quick-view-url";

describe("quick-view URL helpers", () => {
  it("adds quick_view while preserving catalog filters", () => {
    const params = new URLSearchParams({
      page: "2",
      page_size: "24",
      q: "кола",
      category: "kola",
      brand: "Coca-Cola",
      volume: "330 мл",
      package_type: "Стекло",
      sort: "name_asc",
      sales_status: "showcase",
      junk: "drop-me",
    });

    const href = buildCatalogHrefWithQuickView(params, "prod-123");
    const next = new URL(href, "http://localhost");
    expect(next.pathname).toBe("/catalog");
    expect(next.searchParams.get(QUICK_VIEW_PARAM)).toBe("prod-123");
    expect(next.searchParams.get("page")).toBe("2");
    expect(next.searchParams.get("page_size")).toBe("24");
    expect(next.searchParams.get("q")).toBe("кола");
    expect(next.searchParams.get("category")).toBe("kola");
    expect(next.searchParams.get("brand")).toBe("Coca-Cola");
    expect(next.searchParams.get("volume")).toBe("330 мл");
    expect(next.searchParams.get("package_type")).toBe("Стекло");
    expect(next.searchParams.get("sort")).toBe("name_asc");
    expect(next.searchParams.get("sales_status")).toBe("showcase");
    expect(next.searchParams.get("junk")).toBeNull();
  });

  it("removes quick_view on close and keeps filters", () => {
    const params = new URLSearchParams({
      brand: "Sprite",
      page: "3",
      quick_view: "prod-123",
    });
    const href = buildCatalogHrefWithQuickView(params, null);
    const next = new URL(href, "http://localhost");
    expect(next.searchParams.get(QUICK_VIEW_PARAM)).toBeNull();
    expect(next.searchParams.get("brand")).toBe("Sprite");
    expect(next.searchParams.get("page")).toBe("3");
  });

  it("reads quick_view id from search params", () => {
    expect(readQuickViewId(new URLSearchParams("quick_view=abc"))).toBe("abc");
    expect(readQuickViewId(new URLSearchParams("q=test"))).toBeNull();
    expect(readQuickViewId(new URLSearchParams("quick_view=%20"))).toBeNull();
  });

  it("returns bare /catalog when no filters and no quick_view", () => {
    expect(buildCatalogHrefWithQuickView(new URLSearchParams(), null)).toBe(
      "/catalog",
    );
  });
});
