import { Suspense } from "react";
import { StaffNav } from "@/components/staff/staff-nav";
import { StaffOrdersList } from "@/components/staff/staff-orders-list";
import { has_role } from "@/lib/access";
import { require_staff } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

export default async function StaffOrdersPage() {
  const auth = await require_staff();
  const is_director = has_role(auth.user.roles, "director");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <StaffNav {...staff_nav_props(auth)} />
        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
          }
        >
          <StaffOrdersList is_director={is_director} />
        </Suspense>
      </div>
    </main>
  );
}
