"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  add_to_temporary_cart,
  get_temporary_cart_positions_count,
  subscribe_temporary_cart,
  type TemporaryCartItem,
} from "@/lib/cart/temporary-cart-store";

function get_server_snapshot() {
  return 0;
}

export function useTemporaryCartCount() {
  return useSyncExternalStore(
    subscribe_temporary_cart,
    get_temporary_cart_positions_count,
    get_server_snapshot,
  );
}

export function useAddToTemporaryCart() {
  const [toast, set_toast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => set_toast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function add_item(item: TemporaryCartItem) {
    add_to_temporary_cart(item);
    set_toast("Товар добавлен в корзину");
  }

  return { add_item, toast, clear_toast: () => set_toast(null) };
}
