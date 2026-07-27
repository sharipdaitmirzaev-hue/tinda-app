import { redirect } from "next/navigation";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { is_staff } from "@/lib/access";
import { staff_nav_props } from "@/lib/staff/nav-props";
import { StaffNav } from "@/components/staff/staff-nav";
import { ProductInterestList } from "@/components/staff/product-interest-list";

export default async function StaffProductInterestPage() {
  const auth = await get_current_auth_payload();
  if (!auth || !is_staff(auth.user.roles)) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <StaffNav {...staff_nav_props(auth)} />
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">
        Запросы по товарам
      </h1>
      <ProductInterestList />
    </main>
  );
}
