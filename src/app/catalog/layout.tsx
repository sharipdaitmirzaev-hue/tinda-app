import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import {
  CatalogAccessBanner,
  LimitedCatalogHeader,
  PublicCatalogHeader,
} from "@/components/catalog/public-catalog-chrome";
import {
  CatalogViewerProvider,
  type CatalogViewerMode,
} from "@/components/catalog/catalog-viewer-context";
import { can_edit_catalog, can_see_client_prices } from "@/lib/access";
import { require_public_catalog } from "@/lib/auth/require-auth";
import Link from "next/link";

function resolve_viewer_mode(
  payload: Awaited<ReturnType<typeof require_public_catalog>>,
): CatalogViewerMode {
  if (payload && can_edit_catalog(payload)) return "staff";
  if (can_see_client_prices(payload)) return "approved";
  const status = payload?.client?.status;
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  if (status === "blocked") return "blocked";
  return "guest";
}

function StaffCatalogHeader({ full_name }: { full_name: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            ТИНДА · публичный каталог
          </p>
          <p className="text-sm text-slate-600">{full_name}</p>
        </div>
        <Link
          href="/staff/products"
          className="rounded-md bg-teal-800 px-3 py-2 text-sm text-white"
        >
          К staff-каталогу
        </Link>
      </div>
    </header>
  );
}

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const payload = await require_public_catalog();
  const mode = resolve_viewer_mode(payload);
  const approved = mode === "approved";
  const staff = mode === "staff";
  const limited =
    mode === "pending" || mode === "rejected" || mode === "blocked";
  const edit = Boolean(payload && can_edit_catalog(payload));

  return (
    <CatalogViewerProvider mode={mode} can_edit_catalog={edit}>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/40 pb-safe-nav md:pb-8">
        {staff ? (
          <StaffCatalogHeader full_name={payload!.user.full_name} />
        ) : approved ? (
          <ClientHeader full_name={payload!.user.full_name} />
        ) : limited ? (
          <LimitedCatalogHeader full_name={payload!.user.full_name} />
        ) : (
          <PublicCatalogHeader />
        )}
        {limited ? <CatalogAccessBanner status={mode} /> : null}
        {children}
        {approved ? <ClientBottomNav /> : null}
      </div>
    </CatalogViewerProvider>
  );
}
