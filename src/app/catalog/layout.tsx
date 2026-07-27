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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/40 pb-24 md:pb-8">
      <ClientHeader full_name={auth.user.full_name} />
      {children}
      <ClientBottomNav />
    </div>
  );
}
