"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { ProductStatusBadges } from "@/components/catalog/product-status-badges";
import {
  format_rub_price,
  useCanEditCatalog,
  useCatalogViewer,
} from "@/components/catalog/catalog-viewer-context";
import { useAddToServerCart } from "@/hooks/useServerCart";
import { Toast } from "@/components/catalog/toast";
import { ProductInterestForm } from "@/components/catalog/product-interest-form";

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category_id?: string;
  category_name?: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  availability_label?: string;
  sales_status?: string;
  sales_status_label?: string;
  can_add_to_cart?: boolean;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string | null;
  price?: { amount: number; currency: string; unit: string } | null;
};

export function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const viewer = useCatalogViewer();
  const can_edit = useCanEditCatalog();
  const { add_from_catalog, toast, pending } = useAddToServerCart();
  const approved = viewer === "approved";
  const guest = viewer === "guest";
  const sales_status = product.sales_status || "showcase";
  const can_cart = Boolean(approved && product.can_add_to_cart);
  const [interest, set_interest] = useState<"interest" | "price_request" | null>(
    null,
  );

  function on_add() {
    if (!can_cart || pending) return;
    void add_from_catalog({
      product_id: product.id,
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
    });
  }

  let price_block: React.ReactNode = null;
  if (viewer === "staff") {
    price_block = (
      <p className="mt-2 text-xs text-slate-500">Просмотр для staff</p>
    );
  } else if (guest || viewer === "pending") {
    price_block = (
      <p className="mt-2 text-xs text-slate-500">
        Войдите или зарегистрируйтесь, чтобы узнать условия поставки
      </p>
    );
  } else if (approved) {
    if (product.availability === "out_of_stock") {
      price_block = (
        <p className="mt-2 text-xs font-medium text-red-700">Нет в наличии</p>
      );
    } else if (sales_status === "orderable" && product.price) {
      price_block = (
        <p className="mt-2 text-sm font-semibold text-slate-900">
          {format_rub_price(product.price.amount, product.price.unit)}
          {product.availability === "on_order" ? (
            <span className="mt-1 block text-xs font-normal text-amber-700">
              Под заказ
            </span>
          ) : null}
        </p>
      );
    } else if (sales_status === "on_request") {
      price_block = (
        <p className="mt-2 text-xs font-medium text-slate-700">
          Цена по запросу
        </p>
      );
    } else {
      price_block = (
        <p className="mt-2 text-xs font-medium text-slate-700">Витрина</p>
      );
    }
  }

  let action: React.ReactNode = null;
  if (approved) {
    if (product.availability === "out_of_stock") {
      action = (
        <button
          type="button"
          className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          onClick={() => set_interest("interest")}
        >
          Сообщить об интересе
        </button>
      );
    } else if (can_cart) {
      action = (
        <button
          type="button"
          disabled={pending}
          onClick={on_add}
          className="min-h-10 rounded-md bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {pending ? "Добавляем…" : "В корзину"}
        </button>
      );
    } else if (sales_status === "on_request") {
      action = (
        <button
          type="button"
          className="min-h-10 rounded-md bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800"
          onClick={() => set_interest("price_request")}
        >
          Запросить цену
        </button>
      );
    } else {
      action = (
        <button
          type="button"
          className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          onClick={() => set_interest("interest")}
        >
          Интересует товар
        </button>
      );
    }
  }

  return (
    <>
      <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="mb-3 aspect-square w-full"
        />
        <ProductStatusBadges product={product} />
        <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">
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
        {product.category_name ? (
          <p className="text-xs text-slate-500">{product.category_name}</p>
        ) : null}
        <p className="text-xs text-slate-500">Арт. {product.sku}</p>

        {price_block}

        <div className="mt-auto flex flex-col gap-2 pt-3">
          <Link
            href={`/catalog/products/${product.id}`}
            className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-center text-sm text-slate-800"
          >
            Подробнее
          </Link>
          {action}
          {can_edit ? (
            <Link
              href={`/staff/products/${product.id}`}
              className="min-h-10 rounded-md bg-slate-900 px-3 py-2 text-center text-sm text-white"
            >
              Редактировать
            </Link>
          ) : null}
        </div>
      </article>
      <Toast message={toast} />
      {interest ? (
        <ProductInterestForm
          product_id={product.id}
          request_type={interest}
          title={
            interest === "price_request"
              ? "Запросить цену"
              : "Интересует товар"
          }
          on_close={() => set_interest(null)}
        />
      ) : null}
    </>
  );
}
