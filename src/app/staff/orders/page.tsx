import { LogoutButton } from "@/components/auth/logout-button";
import { require_staff } from "@/lib/auth/require-auth";

export default async function StaffOrdersPage() {
  const auth = await require_staff();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
              ТИНДА · сотрудники
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Заказы</h1>
          </div>
          <LogoutButton />
        </div>
        <p className="text-slate-600">
          {auth.user.full_name} ({auth.user.roles.join(", ")}). Список заказов и
          заявок появится на следующих этапах.
        </p>
      </div>
    </main>
  );
}
