import {
  UI_WHOLESALE_CATALOG,
} from "@/lib/i18n/ui-copy";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { client_status_label } from "@/lib/i18n/labels";

export function PublicCatalogHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-teal-900/10 bg-white/95 backdrop-blur">
      <div className="ui-container flex items-center justify-between gap-3 py-3">
        <Link href="/catalog" className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">
            ТИНДА
          </p>
          <p className="truncate text-sm text-slate-600">{UI_WHOLESALE_CATALOG}</p>
        </Link>
        <nav className="flex items-center gap-2" aria-label="Гостевая навигация">
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Войти
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-teal-800/20 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900"
          >
            Регистрация
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LimitedCatalogHeader({
  full_name,
}: {
  full_name?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-teal-900/10 bg-white/95 backdrop-blur">
      <div className="ui-container flex items-center justify-between gap-3 py-3">
        <Link href="/catalog" className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">
            ТИНДА
          </p>
          <p className="truncate text-sm text-slate-600">
            {full_name ? `Здравствуйте, ${full_name}` : UI_WHOLESALE_CATALOG}
          </p>
        </Link>
        <nav className="flex items-center gap-2" aria-label="Навигация">
          <Link
            href="/pending"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Статус заявки
          </Link>
          <Link
            href="/profile"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline"
          >
            Профиль
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}

export function CatalogAccessBanner({ status }: { status: string }) {
  const label = client_status_label(status);
  const message =
    status === "pending"
      ? "Цены и оформление заказов станут доступны после подтверждения регистрации"
      : status === "blocked"
        ? "Доступ к заказам заблокирован. Каталог доступен только для просмотра."
        : "Заявка отклонена — цены и заказы недоступны. Каталог можно просматривать.";

  return (
    <div
      className="border-b border-amber-200/80 bg-amber-50 text-amber-950"
      role="status"
    >
      <div className="ui-container flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
        <p>
          <span className={`ui-status-${status} mr-2`}>{label}</span>
          {message}
        </p>
        <Link
          href="/pending"
          className="shrink-0 font-medium text-teal-900 underline-offset-2 hover:underline"
        >
          Статус заявки
        </Link>
      </div>
    </div>
  );
}
