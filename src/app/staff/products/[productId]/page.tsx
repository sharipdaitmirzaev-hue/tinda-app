import { notFound } from "next/navigation";
import { ProductForm } from "@/components/staff/product-form";
import { StaffNav } from "@/components/staff/staff-nav";
import { require_catalog_editor } from "@/lib/auth/require-auth";
import { AppError } from "@/lib/http/errors";
import { get_staff_product } from "@/lib/services/products.service";
import { staff_nav_props } from "@/lib/staff/nav-props";

type PageProps = { params: Promise<{ productId: string }> };

export default async function EditProductPage({ params }: PageProps) {
  const auth = await require_catalog_editor();
  const { productId } = await params;

  let product;
  try {
    const result = await get_staff_product(auth, productId);
    product = result.product;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <StaffNav {...staff_nav_props(auth)} />
        <ProductForm
          product_id={product.id}
          initial={{
            sku: product.sku,
            name: product.name,
            brand: product.brand ?? "",
            category_id: product.category_id,
            volume_text: product.volume_text ?? "",
            package_type: product.package_type ?? "",
            units_per_package: String(product.units_per_package),
            sale_unit: product.sale_unit,
            min_order_qty: String(product.min_order_qty),
            allow_piece_sale: product.allow_piece_sale,
            description: product.description ?? "",
            availability: product.availability,
            is_promo: product.is_promo,
            is_new: product.is_new,
            is_hit: product.is_hit,
            image_url: product.image_url ?? "",
            is_active: product.is_active,
          }}
        />
      </div>
    </main>
  );
}
