"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { UI_ADDED_TO_ORDER } from "@/lib/i18n/ui-copy";
import {
  add_to_temporary_cart,
  get_temporary_cart_positions_count,
  subscribe_temporary_cart,
  type TemporaryCartProduct,
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

  function add_from_catalog(product: TemporaryCartProduct) {
    const result = add_to_temporary_cart(product, { mode: "initial_or_step" });
    if (result.ok) {
      set_toast(UI_ADDED_TO_ORDER);
    } else {
      set_toast(result.message);
    }
    return result;
  }

  function add_with_qty(product: TemporaryCartProduct, qty: number) {
    const result = add_to_temporary_cart(product, {
      mode: "add_qty",
      qty,
    });
    if (result.ok) {
      set_toast(UI_ADDED_TO_ORDER);
    } else {
      set_toast(result.message);
    }
    return result;
  }

  return {
    add_from_catalog,
    add_with_qty,
    toast,
    clear_toast: () => set_toast(null),
  };
}
