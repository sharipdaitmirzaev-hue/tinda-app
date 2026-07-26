import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { OrderEditClient } from "@/components/orders/order-edit-client";
import { require_client_area } from "@/lib/auth/require-auth";

type Props = { params: Promise<{ orderId: string }> };

export default async function OrderEditPage({ params }: Props) {
  const auth = await require_client_area();
  const { orderId } = await params;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28">
        <OrderEditClient order_id={orderId} />
      </main>
      <ClientBottomNav />
    </div>
  );
}
