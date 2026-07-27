import { Suspense } from "react";
import { ProductsList } from "@/components/staff/products-list";
import { StaffNav } from "@/components/staff/staff-nav";
import { require_catalog_editor } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

export default async function StaffProductsPage() {
  const auth = await require_catalog_editor();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <StaffNav {...staff_nav_props(auth)} />
        <h1 className="mb-4 text-2xl font-semibold">Товары</h1>
        <Suspense fallback={<p className="text-sm text-slate-600">Загрузка…</p>}>
          <ProductsList />
        </Suspense>
      </div>
    </main>
  );
}
