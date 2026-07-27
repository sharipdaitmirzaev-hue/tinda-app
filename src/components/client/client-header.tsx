"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { useServerCartCount } from "@/hooks/useServerCart";

const desktop_links = [
  { href: "/catalog", label: "Каталог" },
  { href: "/cart", label: "Корзина" },
  { href: "/orders", label: "Заказы" },
  { href: "/profile", label: "Профиль" },
];

export function ClientHeader({ full_name }: { full_name?: string }) {
  const cart_count = useServerCartCount();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-teal-900/10 bg-white/95 backdrop-blur">
      <div className="ui-container flex items-center justify-between gap-3 py-3">
        <Link href="/catalog" className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">
            ТИНДА
          </p>
          <p className="truncate text-sm text-slate-600">
            {full_name ? `Здравствуйте, ${full_name}` : "Оптовый каталог"}
          </p>
        </Link>
        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="Основная навигация"
        >
          {desktop_links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? "bg-teal-50 text-teal-900"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
                {link.href === "/cart" && cart_count > 0 ? (
                  <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-teal-800 px-1.5 text-xs text-white">
                    {cart_count}
                  </span>
                ) : null}
              </Link>
            );
          })}
          <LogoutButton />
        </nav>
        <div className="md:hidden">
          <Link
            href="/cart"
            className="relative rounded-md border border-teal-800/20 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900"
            aria-label={`Корзина${cart_count > 0 ? `, товаров: ${cart_count}` : ""}`}
          >
            Корзина
            {cart_count > 0 ? (
              <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-teal-800 px-1.5 text-xs text-white">
                {cart_count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  );
}
