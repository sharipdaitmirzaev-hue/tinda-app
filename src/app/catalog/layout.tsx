import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      {children}
      <ClientBottomNav />
    </div>
  );
}
