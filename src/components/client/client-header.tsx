"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { useServerCartCount } from "@/hooks/useServerCart";

export function ClientHeader({ full_name }: { full_name?: string }) {
  const cart_count = useServerCartCount();

  return (
    <header className="sticky top-0 z-30 border-b border-teal-900/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/catalog" className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">
            ТИНДА
          </p>
          <p className="truncate text-sm text-slate-600">
            {full_name ? `Здравствуйте, ${full_name}` : "Оптовый каталог"}
          </p>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/cart"
            className="relative rounded-md border border-teal-800/20 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900"
          >
            Корзина
            {cart_count > 0 ? (
              <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-teal-800 px-1.5 text-xs text-white">
                {cart_count}
              </span>
            ) : null}
          </Link>
          <div className="hidden sm:block">
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
