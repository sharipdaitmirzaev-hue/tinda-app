import { LogoutButton } from "@/components/auth/logout-button";
import { require_client_area } from "@/lib/auth/require-auth";

export default async function CartPage() {
  await require_client_area();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
              ТИНДА
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Корзина</h1>
          </div>
          <LogoutButton />
        </div>
        <p className="text-slate-600">
          Раздел корзины появится на этапе Э1.8. Доступ открыт только для
          подтверждённых клиентов.
        </p>
      </div>
    </main>
  );
}
