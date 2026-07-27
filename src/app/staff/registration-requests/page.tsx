import { Suspense } from "react";
import { StaffNav } from "@/components/staff/staff-nav";
import { RegistrationRequestsList } from "@/components/staff/registration-requests-list";
import { require_staff } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

export default async function RegistrationRequestsPage() {
  const auth = await require_staff();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <StaffNav {...staff_nav_props(auth)} />
        <h1 className="mb-4 text-2xl font-semibold text-slate-900">
          Заявки на регистрацию
        </h1>
        <Suspense fallback={<p className="text-sm text-slate-600">Загрузка…</p>}>
          <RegistrationRequestsList />
        </Suspense>
      </div>
    </main>
  );
}
