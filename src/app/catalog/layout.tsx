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
import { can_see_client_prices } from "@/lib/access";
import { require_public_catalog } from "@/lib/auth/require-auth";

function resolve_viewer_mode(
  payload: Awaited<ReturnType<typeof require_public_catalog>>,
): CatalogViewerMode {
  if (can_see_client_prices(payload)) return "approved";
  const status = payload?.client?.status;
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  if (status === "blocked") return "blocked";
  return "guest";
}

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const payload = await require_public_catalog();
  const mode = resolve_viewer_mode(payload);
  const approved = mode === "approved";
  const limited =
    mode === "pending" || mode === "rejected" || mode === "blocked";

  return (
    <CatalogViewerProvider mode={mode}>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/40 pb-safe-nav md:pb-8">
        {approved ? (
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
