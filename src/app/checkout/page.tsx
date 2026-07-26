import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";
import { get_cart } from "@/lib/services/cart.service";
import { get_checkout_prefill } from "@/lib/services/order.service";

export default async function CheckoutPage() {
  const auth = await require_client_area();
  const cart = await get_cart(auth);

  if (cart.items_count === 0) {
    redirect("/cart?notice=empty");
  }

  if (!cart.is_ready_to_checkout) {
    redirect("/cart?notice=errors");
  }

  const prefill = await get_checkout_prefill(auth);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28">
        <CheckoutForm cart={cart} prefill={prefill} />
      </main>
      <ClientBottomNav />
    </div>
  );
}
