/**
 * TEMPORARY client-side cart store for E1.6.
 * Full server cart + /cart page will be implemented in E1.8.
 * Do not treat this as production cart persistence.
 */

export type TemporaryCartItem = {
  product_id: string;
  qty: number;
  name: string;
  sku: string;
  image_url: string | null;
};

const STORAGE_KEY = "tinda_temporary_cart_e16";

type Listener = () => void;

let memory_items: TemporaryCartItem[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

function read_storage(): TemporaryCartItem[] {
  if (typeof window === "undefined") return memory_items;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TemporaryCartItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write_storage(items: TemporaryCartItem[]) {
  memory_items = items;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
  listeners.forEach((listener) => listener());
}

function ensure_hydrated() {
  if (hydrated || typeof window === "undefined") return;
  memory_items = read_storage();
  hydrated = true;
}

export function get_temporary_cart_items(): TemporaryCartItem[] {
  ensure_hydrated();
  return memory_items;
}

export function get_temporary_cart_count(): number {
  return get_temporary_cart_items().reduce((sum, item) => sum + item.qty, 0);
}

export function get_temporary_cart_positions_count(): number {
  return get_temporary_cart_items().length;
}

export function add_to_temporary_cart(item: TemporaryCartItem) {
  ensure_hydrated();
  const current = [...memory_items];
  const index = current.findIndex((row) => row.product_id === item.product_id);
  if (index >= 0) {
    current[index] = {
      ...current[index],
      qty: current[index].qty + item.qty,
      name: item.name,
      sku: item.sku,
      image_url: item.image_url,
    };
  } else {
    current.push(item);
  }
  write_storage(current);
}

export function subscribe_temporary_cart(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
