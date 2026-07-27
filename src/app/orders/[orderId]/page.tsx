import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { OrderDetailClient } from "@/components/orders/order-detail-client";
import { require_client_area } from "@/lib/auth/require-auth";

type Props = { params: Promise<{ orderId: string }> };

export default async function OrderDetailPage({ params }: Props) {
  const auth = await require_client_area();
  const { orderId } = await params;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-safe-nav-lg">
        <OrderDetailClient order_id={orderId} />
      </main>
      <ClientBottomNav />
    </div>
  );
}
