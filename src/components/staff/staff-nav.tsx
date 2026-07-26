import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

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
  const links = [
    { href: "/staff/orders", label: "Заказы" },
    { href: "/staff/registration-requests", label: "Заявки" },
    ...(can_edit_catalog
      ? [
          { href: "/staff/categories", label: "Категории" },
          { href: "/staff/products", label: "Товары" },
        ]
      : []),
  ];

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
          ТИНДА · сотрудники
        </p>
        <p className="text-sm text-slate-600">
          {full_name} ({roles.join(", ")})
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
          >
            {link.label}
          </Link>
        ))}
        <LogoutButton />
      </nav>
    </header>
  );
}
