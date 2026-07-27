import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogPagination } from "@/components/catalog/catalog-pagination";
import {
  buildCatalogPageHref,
  clampCatalogPage,
  formatCatalogResultsRange,
  getPaginationItems,
  type PaginationItem,
} from "@/lib/catalog/pagination";

function pages_only(items: PaginationItem[]): number[] {
  return items.filter((i) => i.type === "page").map((i) => i.page);
}

function pattern(items: PaginationItem[]): Array<number | "…"> {
  return items.map((i) => (i.type === "page" ? i.page : "…"));
}

describe("getPaginationItems", () => {
  it("shows all numbers when total_pages <= 7", () => {
    for (const total of [1, 2, 5, 7]) {
      const items = getPaginationItems(1, total);
      expect(pages_only(items)).toEqual(
        Array.from({ length: total }, (_, i) => i + 1),
      );
      expect(items.every((i) => i.type === "page")).toBe(true);
    }
  });

  it("first page: 1 2 3 4 5 … N", () => {
    expect(pattern(getPaginationItems(1, 19))).toEqual([
      1, 2, 3, 4, 5, "…", 19,
    ]);
  });

  it("middle page: 1 … 6 7 8 9 10 … 19", () => {
    expect(pattern(getPaginationItems(8, 19))).toEqual([
      1, "…", 6, 7, 8, 9, 10, "…", 19,
    ]);
  });

  it("last page: 1 … 15 16 17 18 19", () => {
    expect(pattern(getPaginationItems(19, 19))).toEqual([
      1, "…", 15, 16, 17, 18, 19,
    ]);
  });

  it("does not place two ellipses in a row or duplicate numbers", () => {
    for (let page = 1; page <= 25; page += 1) {
      const items = getPaginationItems(page, 25);
      let prev_ellipsis = false;
      const seen = new Set<number>();
      for (const item of items) {
        if (item.type === "ellipsis") {
          expect(prev_ellipsis).toBe(false);
          prev_ellipsis = true;
        } else {
          expect(seen.has(item.page)).toBe(false);
          seen.add(item.page);
          prev_ellipsis = false;
        }
      }
    }
  });

  it("returns empty list for zero/negative totals", () => {
    expect(getPaginationItems(1, 0)).toEqual([]);
    expect(getPaginationItems(1, -3)).toEqual([]);
  });
});

describe("formatCatalogResultsRange + clamp", () => {
  it("formats shown range text", () => {
    expect(
      formatCatalogResultsRange({ page: 2, pageSize: 24, total: 453 }),
    ).toBe("Показаны товары 25–48 из 453");
    expect(
      formatCatalogResultsRange({ page: 1, pageSize: 24, total: 10 }),
    ).toBe("Показаны товары 1–10 из 10");
  });

  it("zero result message", () => {
    expect(
      formatCatalogResultsRange({ page: 1, pageSize: 24, total: 0 }),
    ).toBe("Товары не найдены");
  });

  it("clamps page into valid bounds", () => {
    expect(clampCatalogPage(99, 5, 100)).toBe(5);
    expect(clampCatalogPage(0, 5, 100)).toBe(1);
    expect(clampCatalogPage(3, 5, 0)).toBe(1);
    expect(clampCatalogPage(3, 5, 100)).toBe(3);
  });
});

describe("buildCatalogPageHref preserves filters", () => {
  it("keeps filters, sort and page_size while changing only page", () => {
    const params = new URLSearchParams({
      q: "sprite",
      category: "gazirovannye-napitki",
      brand: "Sprite",
      volume: "2 л",
      package_type: "ПЭТ",
      sales_status: "showcase",
      availability: "on_order",
      is_new: "true",
      has_price: "true",
      sort: "name_desc",
      page_size: "48",
      page: "2",
    });
    const href = buildCatalogPageHref(params, 4);
    const out = new URL(href, "https://tinda.local");
    expect(out.pathname).toBe("/catalog");
    expect(out.searchParams.get("page")).toBe("4");
    expect(out.searchParams.get("q")).toBe("sprite");
    expect(out.searchParams.get("category")).toBe("gazirovannye-napitki");
    expect(out.searchParams.get("brand")).toBe("Sprite");
    expect(out.searchParams.get("volume")).toBe("2 л");
    expect(out.searchParams.get("package_type")).toBe("ПЭТ");
    expect(out.searchParams.get("sales_status")).toBe("showcase");
    expect(out.searchParams.get("availability")).toBe("on_order");
    expect(out.searchParams.get("is_new")).toBe("true");
    expect(out.searchParams.get("has_price")).toBe("true");
    expect(out.searchParams.get("sort")).toBe("name_desc");
    expect(out.searchParams.get("page_size")).toBe("48");
  });
});

describe("CatalogPagination UI", () => {
  it("marks current page with aria-current and disables edges on first page", () => {
    const params = new URLSearchParams({
      brand: "Coca-Cola",
      page_size: "24",
      sort: "name_asc",
    });
    const html = renderToStaticMarkup(
      createElement(CatalogPagination, {
        page: 1,
        page_size: 24,
        total: 453,
        total_pages: 19,
        search_params: params,
        placement: "bottom",
        show_load_more: true,
      }),
    );

    expect(html).toContain('aria-label="Пагинация каталога"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Показаны товары 1–24 из 453");
    expect(html).toContain("Назад");
    expect(html).toContain("Вперёд");
    expect(html).toContain("brand=Coca-Cola");
    expect(html).toContain("page_size=24");
    expect(html).toContain("Показать ещё");
    expect(html).toContain('aria-label="Следующая страница"');
    expect(html).not.toContain('aria-label="Предыдущая страница"');
  });

  it("disables forward controls on the last page", () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPagination, {
        page: 19,
        page_size: 24,
        total: 453,
        total_pages: 19,
        search_params: new URLSearchParams({ page_size: "24" }),
        placement: "bottom",
      }),
    );
    expect(html).toContain("Показаны товары 433–453 из 453");
    expect(html).toContain('aria-label="Предыдущая страница"');
    expect(html).not.toContain('aria-label="Следующая страница"');
  });

  it("keeps mobile-friendly overflow class on page number row", () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPagination, {
        page: 8,
        page_size: 24,
        total: 453,
        total_pages: 19,
        search_params: new URLSearchParams(),
        placement: "bottom",
      }),
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("md:overflow-visible");
  });
});
