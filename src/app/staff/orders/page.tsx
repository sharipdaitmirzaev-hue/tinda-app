import Link from "next/link";
import { StaffNav } from "@/components/staff/staff-nav";
import { require_staff } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

export default async function StaffOrdersPage() {
  const auth = await require_staff();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <StaffNav {...staff_nav_props(auth)} />
        <h1 className="text-2xl font-semibold text-slate-900">Заказы</h1>
        <p className="mt-3 text-slate-600">
          Список заказов появится на следующих этапах. Сейчас доступна работа с{" "}
          <Link
            href="/staff/registration-requests"
            className="text-teal-800 underline"
          >
            заявками на регистрацию
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
