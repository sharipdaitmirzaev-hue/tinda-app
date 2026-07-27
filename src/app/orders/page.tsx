import { Suspense } from "react";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { OrdersListClient } from "@/components/orders/orders-list-client";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function OrdersPage() {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-safe-nav-lg">
        <Suspense
          fallback={
            <div className="space-y-3">
              <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
              <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
            </div>
          }
        >
          <OrdersListClient />
        </Suspense>
      </main>
      <ClientBottomNav />
    </div>
  );
}
