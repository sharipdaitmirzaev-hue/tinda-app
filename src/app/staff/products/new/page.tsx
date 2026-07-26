import { ProductForm } from "@/components/staff/product-form";
import { StaffNav } from "@/components/staff/staff-nav";
import { require_catalog_editor } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

export default async function NewProductPage() {
  const auth = await require_catalog_editor();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <StaffNav {...staff_nav_props(auth)} />
        <ProductForm />
      </div>
    </main>
  );
}
