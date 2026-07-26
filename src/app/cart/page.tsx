import { CartPageClient } from "@/components/cart/cart-page-client";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function CartPage() {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-6 pb-28">
        <CartPageClient />
      </main>
      <ClientBottomNav />
    </div>
  );
}
