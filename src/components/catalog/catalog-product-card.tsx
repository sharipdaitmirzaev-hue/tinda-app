"use client";

import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { can_add_to_cart } from "@/lib/quantity";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/catalog/constants";
import { useAddToTemporaryCart } from "@/hooks/useTemporaryCart";
import { Toast } from "@/components/catalog/toast";

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  availability_label?: string;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string | null;
};

export function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const { add_from_catalog, toast } = useAddToTemporaryCart();
  const allowed = can_add_to_cart(product);
  const availability_label =
    product.availability_label ??
    AVAILABILITY_LABELS[product.availability as Availability] ??
    product.availability;

  function on_add() {
    if (!allowed) return;
    add_from_catalog({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      image_url: product.image_url,
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
    });
  }

  return (
    <>
      <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="mb-3 h-32 w-full"
        />
        <div className="mb-2 flex flex-wrap gap-1 text-[10px] font-medium uppercase tracking-wide">
          {product.is_promo ? (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">
              Акция
            </span>
          ) : null}
          {product.is_new ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">
              Новинка
            </span>
          ) : null}
          {product.is_hit ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
              Хит
            </span>
          ) : null}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">
          {product.name}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {product.brand || "Без бренда"}
        </p>
        <p className="mt-2 text-xs text-slate-600">
          {[product.volume_text, product.package_type]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        <p className="text-xs text-slate-600">
          {product.units_per_package} шт. в упаковке · {product.sale_unit}
        </p>
        <p
          className={`mt-2 text-xs font-medium ${
            product.availability === "out_of_stock"
              ? "text-red-700"
              : product.availability === "on_order"
                ? "text-amber-700"
                : "text-teal-800"
          }`}
        >
          {availability_label}
        </p>
        <div className="mt-auto flex flex-col gap-2 pt-3">
          <Link
            href={`/catalog/products/${product.id}`}
            className="rounded-md border border-slate-300 px-3 py-2 text-center text-sm text-slate-800"
          >
            Подробнее
          </Link>
          <button
            type="button"
            disabled={!allowed}
            onClick={on_add}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            В корзину
          </button>
        </div>
      </article>
      <Toast message={toast} />
    </>
  );
}
