/** @vitest-environment jsdom */
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogProductCard } from "@/components/catalog/catalog-product-card";
import {
  CatalogQuickView,
  clearQuickViewCache,
} from "@/components/catalog/catalog-quick-view";
import { CatalogViewerProvider } from "@/components/catalog/catalog-viewer-context";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...props }, children),
}));

const add_with_qty_mock = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/hooks/useServerCart", () => ({
  useAddToServerCart: () => ({
    add_from_catalog: vi.fn(async () => ({ ok: true as const })),
    add_with_qty: add_with_qty_mock,
    toast: "Товар добавлен в корзину",
    pending: false,
    clear_toast: vi.fn(),
  }),
  useServerCart: () => ({
    cart: null,
    loading: false,
    error: null,
    migration_message: null,
    mutating: false,
  }),
  useServerCartCount: () => 0,
}));

const sample_list_product = {
  id: "prod-qv-1",
  sku: "SKU-QV-1",
  name: "Тестовый напиток",
  brand: "TestBrand",
  category_name: "Кола",
  volume_text: "330 мл",
  package_type: "Стекло",
  units_per_package: 24,
  sale_unit: "шт",
  min_order_qty: 24,
  allow_piece_sale: false,
  availability: "in_stock",
  sales_status: "orderable",
  can_add_to_cart: true,
  is_promo: false,
  is_new: true,
  is_hit: false,
  image_url: "/uploads/products/test.webp",
  price: { amount: 1200, currency: "RUB", unit: "уп." },
};

const sample_detail = {
  ...sample_list_product,
  category: { id: "cat-1", name: "Кола" },
  description: "Краткое описание товара",
  availability_label: "В наличии",
  sales_status_label: "Можно заказать",
};

function wrap(ui: React.ReactNode, mode: "guest" | "approved" = "guest") {
  return render(
    createElement(CatalogViewerProvider, { mode, children: ui }),
  );
}


describe("catalog quick view UI", () => {
  beforeEach(() => {
    clearQuickViewCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ product: sample_detail }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    clearQuickViewCache();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows quick view button on product card", () => {
    const on_quick_view = vi.fn();
    wrap(
      createElement(CatalogProductCard, {
        product: sample_list_product,
        on_quick_view,
      }),
    );
    const btn = screen.getByTestId("quick-view-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Быстрый просмотр|Просмотр/);
  });

  it("opens modal and loads product on demand", async () => {
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
      "approved",
    );

    expect(screen.getByTestId("catalog-quick-view")).toBeTruthy();
    expect(screen.getByTestId("catalog-quick-view-loading")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: sample_detail.name })).toBeTruthy();
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/catalog/products/${sample_detail.id}`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(screen.getByText(sample_detail.sku)).toBeTruthy();
    expect(screen.getByText("Кола")).toBeTruthy();
    expect(screen.getByText(/Краткое описание/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть страницу товара" })).toHaveProperty(
      "href",
      expect.stringContaining(`/catalog/products/${sample_detail.id}`),
    );
  });

  it("closes modal on Escape", async () => {
    const on_close = vi.fn();
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close,
      }),
    );
    await waitFor(() => screen.getByRole("heading", { name: sample_detail.name }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(on_close).toHaveBeenCalled();
  });

  it("closes modal on backdrop click", async () => {
    const on_close = vi.fn();
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close,
      }),
    );
    await waitFor(() => screen.getByRole("heading", { name: sample_detail.name }));
    fireEvent.click(screen.getByTestId("catalog-quick-view-backdrop"));
    expect(on_close).toHaveBeenCalled();
  });

  it("restores focus to trigger button after close", async () => {
    const on_close = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);

    const { unmount } = wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close,
        return_focus_el: trigger,
      }),
    );
    await waitFor(() =>
      screen.getByRole("heading", { name: sample_detail.name }),
    );
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("guest does not see closed price", async () => {
    const guest_product = {
      ...sample_detail,
      price: undefined,
      guest_hint: "Войдите или зарегистрируйтесь, чтобы узнать условия поставки",
      can_add_to_cart: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ product: guest_product }),
      })),
    );

    wrap(
      createElement(CatalogQuickView, {
        product_id: guest_product.id,
        on_close: vi.fn(),
      }),
      "guest",
    );

    await waitFor(() => screen.getByRole("heading", { name: guest_product.name }));
    expect(screen.queryByText(/1\s?200/)).toBeNull();
    expect(
      screen.getByText(/Войдите или зарегистрируйтесь/),
    ).toBeTruthy();
  });

  it("approved client sees allowed price for orderable", async () => {
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
      "approved",
    );
    await waitFor(() =>
      screen.getByRole("heading", { name: sample_detail.name }),
    );
    expect(screen.getByText(/1[\s\u00a0]?200/)).toBeTruthy();
    expect(screen.getByTestId("quick-view-add-to-cart")).toBeTruthy();
  });

  it("orderable product can be added to cart from quick view", async () => {
    add_with_qty_mock.mockClear();
    const user = userEvent.setup();
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
      "approved",
    );
    await waitFor(() =>
      screen.getByRole("heading", { name: sample_detail.name }),
    );
    await user.click(screen.getByTestId("quick-view-add-to-cart"));
    expect(add_with_qty_mock).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: sample_detail.id }),
      24,
    );
    expect(screen.getByTestId("quick-view-cart-ok").textContent).toMatch(
      /добавлен/i,
    );
  });

  it("showcase sends interest request", async () => {
    const showcase = {
      ...sample_detail,
      sales_status: "showcase",
      sales_status_label: "Витрина",
      can_add_to_cart: false,
      price: undefined,
    };
    const fetch_mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/interest")) {
        return {
          ok: true,
          json: async () => ({
            message: "Запрос отправлен. Менеджер свяжется с вами",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ product: showcase }),
      };
    });
    vi.stubGlobal("fetch", fetch_mock);

    const user = userEvent.setup();
    wrap(
      createElement(CatalogQuickView, {
        product_id: showcase.id,
        on_close: vi.fn(),
      }),
      "approved",
    );

    await waitFor(() => screen.getByRole("heading", { name: showcase.name }));
    await user.clear(screen.getByLabelText(/Желаемое количество/));
    await user.type(screen.getByLabelText(/Желаемое количество/), "10");
    await user.type(screen.getByLabelText(/Комментарий/), "Нужен прайс");
    await user.click(screen.getByRole("button", { name: "Отправить запрос" }));

    await waitFor(() =>
      expect(screen.getByText(/Запрос отправлен/)).toBeTruthy(),
    );
    expect(fetch_mock).toHaveBeenCalledWith(
      `/api/v1/client/products/${showcase.id}/interest`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows not-found error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: { message: "Товар не найден" },
        }),
      })),
    );

    wrap(
      createElement(CatalogQuickView, {
        product_id: "missing",
        on_close: vi.fn(),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("catalog-quick-view-error").textContent).toMatch(
        /не найден/i,
      ),
    );
  });

  it("mobile dialog uses full-screen layout classes", async () => {
    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
    );
    await waitFor(() => screen.getByRole("heading", { name: sample_detail.name }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("h-full");
    expect(dialog.className).toContain("md:max-w-[900px]");
    expect(dialog.className).toContain("w-full");
  });

  it("card quick view button stays compact for mobile cards", () => {
    wrap(
      createElement(CatalogProductCard, {
        product: sample_list_product,
        on_quick_view: vi.fn(),
      }),
    );
    const btn = screen.getByTestId("quick-view-button");
    expect(btn.className).toContain("shrink-0");
    expect(btn.className).toContain("text-xs");
    expect(btn.querySelector(".sm\\:hidden")?.textContent).toBe("Просмотр");
  });

  it("caches product within session and skips second fetch", async () => {
    const fetch_mock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ product: sample_detail }),
    }));
    vi.stubGlobal("fetch", fetch_mock);

    const first = wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
    );
    await waitFor(() => screen.getByRole("heading", { name: sample_detail.name }));
    first.unmount();

    wrap(
      createElement(CatalogQuickView, {
        product_id: sample_detail.id,
        on_close: vi.fn(),
      }),
    );
    await waitFor(() => screen.getByRole("heading", { name: sample_detail.name }));
    expect(fetch_mock).toHaveBeenCalledTimes(1);
  });
});
