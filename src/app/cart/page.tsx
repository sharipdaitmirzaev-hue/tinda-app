import Link from "next/link";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function CartPage() {
  const auth = await require_client_area();

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-8 pb-24">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Корзина</h1>
          <p className="mt-3 text-slate-600">
            Полноценная страница корзины будет в Э1.8. Сейчас товары добавляются
            во временное хранилище браузера (E1.6 temporary cart), счётчик
            позиций виден в шапке каталога.
          </p>
          <Link
            href="/catalog"
            className="mt-4 inline-block rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
          >
            Вернуться в каталог
          </Link>
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
