import { CartPageClient } from "@/components/cart/cart-page-client";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

type Props = {
  searchParams: Promise<{ notice?: string }>;
};

export default async function CartPage({ searchParams }: Props) {
  const auth = await require_client_area();
  const params = await searchParams;
  const notice =
    params.notice === "empty"
      ? "Корзина пуста"
      : params.notice === "errors"
        ? "Исправьте ошибки в корзине перед оформлением заказа"
        : null;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-6 pb-28">
        <CartPageClient notice={notice} />
      </main>
      <ClientBottomNav />
    </div>
  );
}
