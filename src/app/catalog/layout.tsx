import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import {
  CatalogAccessBanner,
  LimitedCatalogHeader,
  PublicCatalogHeader,
} from "@/components/catalog/public-catalog-chrome";
import { can_see_client_prices } from "@/lib/access";
import { require_public_catalog } from "@/lib/auth/require-auth";

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const payload = await require_public_catalog();
  const approved = can_see_client_prices(payload);
  const client_status = payload?.client?.status;
  const limited =
    Boolean(payload?.client) &&
    client_status !== undefined &&
    client_status !== "approved";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/40 pb-24 md:pb-8">
      {approved ? (
        <ClientHeader full_name={payload!.user.full_name} />
      ) : limited ? (
        <LimitedCatalogHeader full_name={payload!.user.full_name} />
      ) : (
        <PublicCatalogHeader />
      )}
      {limited && client_status ? (
        <CatalogAccessBanner status={client_status} />
      ) : null}
      {children}
      {approved ? <ClientBottomNav /> : null}
    </div>
  );
}
