/**
 * Client-side mirror of the server cart (E1.8).
 * Source of truth is PostgreSQL via /api/v1/cart.
 */

import {
  can_add_to_cart,
  get_initial_qty,
  get_order_step,
  normalize_cart_qty,
  type QuantityProduct,
} from "@/lib/quantity";
import type { SerializedCart } from "@/lib/cart/types";

export const TEMPORARY_CART_STORAGE_KEY = "tinda_temporary_cart_e16";
export const CART_MIGRATION_FLAG_KEY = "tinda_server_cart_migrated_e18";

type Listener = () => void;

type CartState = {
  cart: SerializedCart | null;
  loading: boolean;
  error: string | null;
  migration_message: string | null;
  mutating: boolean;
};

const empty_cart: SerializedCart = {
  items: [],
  items_count: 0,
  total_qty: 0,
  is_ready_to_checkout: false,
};

let state: CartState = {
  cart: null,
  loading: false,
  error: null,
  migration_message: null,
  mutating: false,
};

let bootstrapped = false;
let bootstrap_promise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function set_state(patch: Partial<CartState>) {
  state = { ...state, ...patch };
  notify();
}

function get_storage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

async function parse_api_error(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data?.error?.message ?? "Не удалось выполнить запрос";
  } catch {
    return "Не удалось выполнить запрос";
  }
}

async function fetch_cart(): Promise<SerializedCart> {
  const response = await fetch("/api/v1/cart", { credentials: "same-origin" });
  if (response.status === 401) {
    throw new Error("Требуется вход в систему");
  }
  if (response.status === 403) {
    throw new Error("Корзина доступна после подтверждения заявки");
  }
  if (!response.ok) {
    throw new Error(await parse_api_error(response));
  }
  return (await response.json()) as SerializedCart;
}

type TemporaryRawItem = {
  product_id: string;
  qty: number;
  units_per_package: number;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  is_active?: boolean;
};

function read_temporary_cart_for_migration(): TemporaryRawItem[] {
  const storage = get_storage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(TEMPORARY_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const by_id = new Map<string, TemporaryRawItem>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.product_id !== "string") continue;
      if (typeof row.units_per_package !== "number") continue;
      if (typeof row.min_order_qty !== "number") continue;
      if (typeof row.allow_piece_sale !== "boolean") continue;
      if (typeof row.availability !== "string") continue;

      const product: QuantityProduct = {
        units_per_package: row.units_per_package,
        min_order_qty: row.min_order_qty,
        allow_piece_sale: row.allow_piece_sale,
        availability: row.availability,
        is_active: typeof row.is_active === "boolean" ? row.is_active : true,
      };

      if (!can_add_to_cart(product)) continue;

      const qty_raw = typeof row.qty === "number" ? row.qty : get_initial_qty(product);
      const qty = normalize_cart_qty(product, qty_raw);
      if (qty === null) continue;

      const existing = by_id.get(row.product_id);
      if (existing) {
        const merged = normalize_cart_qty(product, existing.qty + qty);
        if (merged === null) continue;
        by_id.set(row.product_id, { ...existing, qty: merged });
      } else {
        by_id.set(row.product_id, {
          product_id: row.product_id,
          qty,
          units_per_package: product.units_per_package,
          min_order_qty: product.min_order_qty,
          allow_piece_sale: product.allow_piece_sale,
          availability: row.availability,
          is_active: product.is_active,
        });
      }
    }
    return Array.from(by_id.values());
  } catch {
    return [];
  }
}

/**
 * One-time import from legacy localStorage cart into server cart.
 * Exported for tests.
 */
export async function migrate_temporary_cart_once(
  post_item: (product_id: string, qty: number) => Promise<void> = async (
    product_id,
    qty,
  ) => {
    const response = await fetch("/api/v1/cart/items", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id, qty }),
    });
    if (!response.ok) {
      throw new Error(await parse_api_error(response));
    }
  },
): Promise<string | null> {
  const storage = get_storage();
  if (!storage) return null;
  if (storage.getItem(CART_MIGRATION_FLAG_KEY)) return null;

  const items = read_temporary_cart_for_migration();
  if (items.length === 0) {
    storage.setItem(CART_MIGRATION_FLAG_KEY, "1");
    try {
      storage.removeItem(TEMPORARY_CART_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }

  try {
    for (const item of items) {
      await post_item(item.product_id, item.qty);
    }

    storage.setItem(CART_MIGRATION_FLAG_KEY, "1");
    storage.removeItem(TEMPORARY_CART_STORAGE_KEY);
    return "Товары из временной корзины перенесены";
  } catch (error) {
    storage.setItem(CART_MIGRATION_FLAG_KEY, "error");
    return error instanceof Error
      ? `Не удалось перенести временную корзину: ${error.message}`
      : "Не удалось перенести временную корзину";
  }
}

export function get_server_cart_state(): CartState {
  return state;
}

export function get_server_cart_count(): number {
  return state.cart?.items_count ?? 0;
}

export function subscribe_server_cart(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function bootstrap_server_cart(): Promise<void> {
  if (bootstrapped) return;
  if (bootstrap_promise) return bootstrap_promise;

  bootstrap_promise = (async () => {
    set_state({ loading: true, error: null });
    try {
      const migration_message = await migrate_temporary_cart_once();
      const cart = await fetch_cart();
      set_state({
        cart,
        loading: false,
        error: null,
        migration_message,
      });
      bootstrapped = true;
    } catch (error) {
      set_state({
        loading: false,
        error:
          error instanceof Error ? error.message : "Не удалось загрузить корзину",
        cart: state.cart,
      });
    } finally {
      bootstrap_promise = null;
    }
  })();

  return bootstrap_promise;
}

export async function refresh_server_cart(): Promise<SerializedCart> {
  set_state({ loading: true, error: null });
  try {
    const cart = await fetch_cart();
    set_state({ cart, loading: false, error: null });
    bootstrapped = true;
    return cart;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось загрузить корзину";
    set_state({ loading: false, error: message });
    throw error;
  }
}

export async function add_server_cart_item(
  product_id: string,
  qty: number,
): Promise<SerializedCart> {
  set_state({ mutating: true, error: null });
  try {
    const response = await fetch("/api/v1/cart/items", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id, qty }),
    });
    if (!response.ok) {
      throw new Error(await parse_api_error(response));
    }
    const cart = (await response.json()) as SerializedCart;
    set_state({ cart, mutating: false });
    return cart;
  } catch (error) {
    set_state({ mutating: false });
    throw error;
  }
}

export async function update_server_cart_item(
  product_id: string,
  qty: number,
): Promise<SerializedCart> {
  set_state({ mutating: true, error: null });
  try {
    const response = await fetch(`/api/v1/cart/items/${product_id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty }),
    });
    if (!response.ok) {
      throw new Error(await parse_api_error(response));
    }
    const cart = (await response.json()) as SerializedCart;
    set_state({ cart, mutating: false });
    return cart;
  } catch (error) {
    set_state({ mutating: false });
    throw error;
  }
}

export async function remove_server_cart_item(
  product_id: string,
): Promise<SerializedCart> {
  set_state({ mutating: true, error: null });
  try {
    const response = await fetch(`/api/v1/cart/items/${product_id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(await parse_api_error(response));
    }
    const cart = (await response.json()) as SerializedCart;
    set_state({ cart, mutating: false });
    return cart;
  } catch (error) {
    set_state({ mutating: false });
    throw error;
  }
}

export async function clear_server_cart(): Promise<SerializedCart> {
  set_state({ mutating: true, error: null });
  try {
    const response = await fetch("/api/v1/cart", {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(await parse_api_error(response));
    }
    const cart = (await response.json()) as SerializedCart;
    set_state({ cart, mutating: false });
    return cart;
  } catch (error) {
    set_state({ mutating: false });
    throw error;
  }
}

export type AddableCartProduct = QuantityProduct & {
  product_id: string;
};

/**
 * Catalog card: first add = min qty, next add = +step.
 */
export async function add_from_catalog_card(
  product: AddableCartProduct,
): Promise<SerializedCart> {
  if (!can_add_to_cart(product)) {
    throw new Error("Товара временно нет");
  }
  if (!state.cart) {
    await bootstrap_server_cart();
  }
  const existing = state.cart?.items.find(
    (item) => item.product_id === product.product_id,
  );
  const qty = existing ? get_order_step(product) : get_initial_qty(product);
  return add_server_cart_item(product.product_id, qty);
}

/**
 * Product detail: add selected qty to existing.
 */
export async function add_from_product_detail(
  product: AddableCartProduct,
  qty: number,
): Promise<SerializedCart> {
  if (!can_add_to_cart(product)) {
    throw new Error("Товара временно нет");
  }
  return add_server_cart_item(product.product_id, qty);
}

export function clear_migration_message() {
  if (state.migration_message) {
    set_state({ migration_message: null });
  }
}

/** Test helper */
export function reset_server_cart_store_for_tests() {
  state = {
    cart: null,
    loading: false,
    error: null,
    migration_message: null,
    mutating: false,
  };
  bootstrapped = false;
  bootstrap_promise = null;
  const storage = get_storage();
  storage?.removeItem(CART_MIGRATION_FLAG_KEY);
  notify();
}

export function get_empty_cart(): SerializedCart {
  return empty_cart;
}

/** After successful checkout — sync client mirror without waiting for GET. */
export function mark_server_cart_empty() {
  set_state({
    cart: { ...empty_cart },
    loading: false,
    error: null,
    mutating: false,
  });
}
