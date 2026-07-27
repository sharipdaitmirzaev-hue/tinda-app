"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useServerCartCount } from "@/hooks/useServerCart";

const links = [
  { href: "/catalog", label: "Каталог" },
  { href: "/cart", label: "Корзина" },
  { href: "/orders", label: "Заказы" },
  { href: "/profile", label: "Профиль" },
];

export function ClientBottomNav() {
  const pathname = usePathname();
  const cart_count = useServerCartCount();

  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-2 pt-2 md:hidden"
      style={{
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1">
        {links.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`relative flex flex-col items-center rounded-md px-2 py-1.5 text-xs ${
                  active
                    ? "bg-teal-50 font-semibold text-teal-900"
                    : "text-slate-600"
                }`}
              >
                {link.label}
                {link.href === "/cart" && cart_count > 0 ? (
                  <span className="absolute right-2 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-800 px-1 text-[10px] text-white">
                    {cart_count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
