"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  add_from_catalog_card,
  add_from_product_detail,
  bootstrap_server_cart,
  clear_migration_message,
  clear_server_cart,
  get_server_cart_count,
  get_server_cart_state,
  refresh_server_cart,
  remove_server_cart_item,
  subscribe_server_cart,
  update_server_cart_item,
  type AddableCartProduct,
} from "@/lib/cart/server-cart-store";

function get_server_snapshot_count() {
  return 0;
}

function get_server_snapshot_state() {
  return {
    cart: null,
    loading: true,
    error: null,
    migration_message: null,
    mutating: false,
  };
}

export function useServerCartCount() {
  useEffect(() => {
    void bootstrap_server_cart();
  }, []);

  return useSyncExternalStore(
    subscribe_server_cart,
    get_server_cart_count,
    get_server_snapshot_count,
  );
}

export function useServerCart() {
  useEffect(() => {
    void bootstrap_server_cart();
  }, []);

  return useSyncExternalStore(
    subscribe_server_cart,
    get_server_cart_state,
    get_server_snapshot_state,
  );
}

export function useAddToServerCart() {
  const [toast, set_toast] = useState<string | null>(null);
  const [pending, set_pending] = useState(false);
  const { migration_message } = useServerCart();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => set_toast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!migration_message) return;
    set_toast(migration_message);
    clear_migration_message();
  }, [migration_message]);

  async function add_from_catalog(product: AddableCartProduct) {
    if (pending) return { ok: false as const, message: "Подождите…" };
    set_pending(true);
    try {
      await add_from_catalog_card(product);
      set_toast("Товар добавлен в корзину");
      return { ok: true as const };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось добавить товар";
      set_toast(message);
      return { ok: false as const, message };
    } finally {
      set_pending(false);
    }
  }

  async function add_with_qty(product: AddableCartProduct, qty: number) {
    if (pending) return { ok: false as const, message: "Подождите…" };
    set_pending(true);
    try {
      await add_from_product_detail(product, qty);
      set_toast("Товар добавлен в корзину");
      return { ok: true as const };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось добавить товар";
      set_toast(message);
      return { ok: false as const, message };
    } finally {
      set_pending(false);
    }
  }

  return {
    add_from_catalog,
    add_with_qty,
    toast,
    pending,
    clear_toast: () => set_toast(null),
  };
}

export {
  refresh_server_cart,
  update_server_cart_item,
  remove_server_cart_item,
  clear_server_cart,
};
