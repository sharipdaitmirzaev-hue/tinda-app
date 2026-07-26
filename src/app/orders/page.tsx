import Link from "next/link";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function OrdersPage() {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-8 pb-24">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Заказы</h1>
          <p className="mt-3 text-slate-600">
            История заказов появится на этапе Э1.10.
          </p>
          <Link
            href="/catalog"
            className="mt-4 inline-block text-sm text-teal-800 underline"
          >
            В каталог
          </Link>
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
