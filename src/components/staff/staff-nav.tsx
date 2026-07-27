"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { format_role_labels } from "@/lib/i18n/labels";

type Props = {
  full_name: string;
  roles: string[];
  can_edit_catalog?: boolean;
};

export function StaffNav({
  full_name,
  roles,
  can_edit_catalog = false,
}: Props) {
  const pathname = usePathname();
  const links = [
    { href: "/staff/orders", label: "Заказы" },
    { href: "/staff/registration-requests", label: "Заявки клиентов" },
    { href: "/staff/product-interest", label: "Спрос по товарам" },
    ...(can_edit_catalog
      ? [
          { href: "/staff/categories", label: "Категории" },
          { href: "/staff/products", label: "Товары" },
        ]
      : []),
  ];

  return (
    <header className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
            ТИНДА · сотрудники
          </p>
          <p className="text-sm text-slate-600">
            {full_name} ({format_role_labels(roles)})
          </p>
        </div>
        <div className="hidden sm:block">
          <LogoutButton />
        </div>
      </div>
      <nav
        className="mt-3 flex flex-wrap items-center gap-2"
        aria-label="Навигация сотрудника"
      >
        {links.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active
                  ? "bg-teal-50 text-teal-900"
                  : "text-teal-800 hover:bg-slate-50"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
        <div className="sm:hidden">
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}
