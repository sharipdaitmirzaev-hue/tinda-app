import Link from "next/link";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function CheckoutStubPage() {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-8 pb-24">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Оформление заказа</h1>
          <p className="mt-3 text-slate-600">
            Оформление заказа будет доступно в следующем этапе (Э1.9).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/cart"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-800"
            >
              Вернуться в корзину
            </Link>
            <Link
              href="/catalog"
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
            >
              В каталог
            </Link>
          </div>
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
