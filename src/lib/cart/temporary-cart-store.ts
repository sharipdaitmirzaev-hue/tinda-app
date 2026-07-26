/**
 * LEGACY temporary cart (E1.6 / E1.7).
 * Kept only for one-time migration into the server cart (E1.8).
 * New add/update/delete operations must use /api/v1/cart.
 */

import {
  can_add_to_cart,
  check_qty,
  get_initial_qty,
  get_order_step,
  normalize_cart_qty,
  type QuantityProduct,
} from "@/lib/quantity";

export type TemporaryCartProduct = QuantityProduct & {
  product_id: string;
  name: string;
  sku: string;
  image_url: string | null;
};

export type TemporaryCartItem = TemporaryCartProduct & {
  qty: number;
};

const STORAGE_KEY = "tinda_temporary_cart_e16";

type Listener = () => void;

let memory_items: TemporaryCartItem[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

function get_storage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function is_product_shape(value: unknown): value is TemporaryCartProduct {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.product_id === "string" &&
    typeof row.name === "string" &&
    typeof row.sku === "string" &&
    typeof row.units_per_package === "number" &&
    typeof row.min_order_qty === "number" &&
    typeof row.allow_piece_sale === "boolean" &&
    typeof row.availability === "string"
  );
}

function sanitize_items(raw: unknown): TemporaryCartItem[] {
  if (!Array.isArray(raw)) return [];

  const by_id = new Map<string, TemporaryCartItem>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (!is_product_shape(row)) continue;

    const product: TemporaryCartProduct = {
      product_id: row.product_id,
      name: row.name,
      sku: row.sku,
      image_url: typeof row.image_url === "string" ? row.image_url : null,
      units_per_package: row.units_per_package,
      min_order_qty: row.min_order_qty,
      allow_piece_sale: row.allow_piece_sale,
      availability: row.availability,
      is_active: typeof row.is_active === "boolean" ? row.is_active : true,
    };

    if (!can_add_to_cart(product)) {
      continue;
    }

    const qty_value = (entry as Record<string, unknown>).qty;
    const qty_raw =
      typeof qty_value === "number" ? qty_value : get_initial_qty(product);
    const qty = normalize_cart_qty(product, qty_raw);
    if (qty === null) continue;

    const existing = by_id.get(product.product_id);
    if (existing) {
      const merged = normalize_cart_qty(product, existing.qty + qty);
      if (merged === null) continue;
      by_id.set(product.product_id, { ...product, qty: merged });
    } else {
      by_id.set(product.product_id, { ...product, qty });
    }
  }

  return Array.from(by_id.values());
}

function read_storage(): TemporaryCartItem[] {
  const storage = get_storage();
  if (!storage) return memory_items;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitize_items(JSON.parse(raw));
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return [];
  }
}

function write_storage(items: TemporaryCartItem[]) {
  const clean = sanitize_items(items);
  memory_items = clean;
  const storage = get_storage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // ignore quota / private mode
    }
  }
  notify();
}

function ensure_hydrated() {
  if (hydrated) return;
  memory_items = read_storage();
  hydrated = true;
  write_storage(memory_items);
}

export function get_temporary_cart_items(): TemporaryCartItem[] {
  ensure_hydrated();
  return memory_items;
}

export function get_temporary_cart_positions_count(): number {
  return get_temporary_cart_items().length;
}

export function get_temporary_cart_units_count(): number {
  return get_temporary_cart_items().reduce((sum, item) => sum + item.qty, 0);
}

export type AddToCartResult =
  | { ok: true; item: TemporaryCartItem }
  | { ok: false; message: string };

/**
 * Add product to temporary cart.
 * - first add: initial min allowed qty
 * - next adds with mode "initial_or_step": increase by step
 * - mode "add_qty": add provided qty (product detail page)
 */
export function add_to_temporary_cart(
  product: TemporaryCartProduct,
  options?: { qty?: number; mode?: "initial_or_step" | "add_qty" },
): AddToCartResult {
  ensure_hydrated();

  if (!can_add_to_cart(product)) {
    return { ok: false, message: "Товара временно нет" };
  }

  const mode = options?.mode ?? "initial_or_step";
  const step = get_order_step(product);
  const current = [...memory_items];
  const index = current.findIndex((row) => row.product_id === product.product_id);

  let next_qty: number;
  if (index >= 0) {
    if (mode === "add_qty") {
      const add_qty = options?.qty ?? get_initial_qty(product);
      next_qty = current[index].qty + add_qty;
    } else {
      next_qty = current[index].qty + step;
    }
  } else if (mode === "add_qty") {
    next_qty = options?.qty ?? get_initial_qty(product);
  } else {
    next_qty = get_initial_qty(product);
  }

  const check = check_qty(product, next_qty);
  const final_qty = check.valid ? next_qty : check.suggested_qty;
  const normalized = normalize_cart_qty(product, final_qty);
  if (normalized === null) {
    return { ok: false, message: "Товара временно нет" };
  }

  const item: TemporaryCartItem = {
    ...product,
    qty: normalized,
  };

  if (index >= 0) {
    current[index] = item;
  } else {
    current.push(item);
  }

  write_storage(current);
  return { ok: true, item };
}

export function subscribe_temporary_cart(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: reset in-memory + storage state. */
export function reset_temporary_cart_for_tests() {
  memory_items = [];
  hydrated = false;
  const storage = get_storage();
  storage?.removeItem(STORAGE_KEY);
  notify();
}
