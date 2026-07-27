"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { QuantityStepper } from "@/components/catalog/quantity-stepper";
import { Toast } from "@/components/catalog/toast";
import { useAddToServerCart } from "@/hooks/useServerCart";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/catalog/constants";
import {
  can_add_to_cart,
  check_qty,
  get_initial_qty,
} from "@/lib/quantity";

type CatalogProductDetail = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: { id: string; name: string } | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  description: string | null;
  availability: string;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string | null;
};

export function ProductDetailClient({ product_id }: { product_id: string }) {
  const [product, set_product] = useState<CatalogProductDetail | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [qty, set_qty] = useState(1);
  const { add_with_qty, toast, pending } = useAddToServerCart();

  async function load() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/catalog/products/${product_id}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить товар");
      }
      const next = data.product as CatalogProductDetail;
      set_product(next);
      set_qty(get_initial_qty(next));
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
      set_product(null);
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product_id]);

  if (loading) {
    return <div className="h-96 animate-pulse rounded-xl bg-slate-200" />;
  }

  if (error || !product) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{error ?? "Товар не найден"}</p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-white"
        >
          Повторить
        </button>
      </div>
    );
  }

  const quantity_product = {
    units_per_package: product.units_per_package,
    min_order_qty: product.min_order_qty,
    allow_piece_sale: product.allow_piece_sale,
    availability: product.availability,
  };

  const allowed = can_add_to_cart(quantity_product);
  const qty_check = check_qty(quantity_product, qty);
  const availability_label =
    AVAILABILITY_LABELS[product.availability as Availability] ??
    product.availability;

  function on_add() {
    if (!product || !allowed || !qty_check.valid || pending) return;
    void add_with_qty(
      {
        product_id: product.id,
        ...quantity_product,
      },
      qty,
    );
  }

  return (
    <>
      <div className="grid gap-6 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 md:p-6">
        <div className="md:sticky md:top-20 md:self-start">
          <ProductImage
            src={product.image_url}
            alt={product.name}
            className="h-72 w-full md:min-h-[28rem]"
          />
        </div>

        <div className="space-y-4 pb-4">
          <div>
            <Link href="/catalog" className="text-sm text-teal-800 underline">
              ← Назад в каталог
            </Link>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-medium uppercase">
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
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              {product.name}
            </h1>
            <p className="text-slate-600">{product.brand || "Без бренда"}</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Артикул</dt>
              <dd>{product.sku}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Категория</dt>
              <dd>{product.category?.name || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Объём / вес</dt>
              <dd>{product.volume_text || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Тип упаковки</dt>
              <dd>{product.package_type || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Шт. в упаковке</dt>
              <dd>{product.units_per_package}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Единица продажи</dt>
              <dd>{product.sale_unit}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Минимальный заказ</dt>
              <dd>{product.min_order_qty}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Поштучно</dt>
              <dd>{product.allow_piece_sale ? "Да" : "Нет"}</dd>
            </div>
          </dl>

          <p
            className={`text-sm font-medium ${
              product.availability === "out_of_stock"
                ? "text-red-700"
                : product.availability === "on_order"
                  ? "text-amber-700"
                  : "text-teal-800"
            }`}
          >
            {availability_label}
          </p>

          {product.availability === "out_of_stock" ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              Товара временно нет
            </p>
          ) : null}

          {product.availability === "on_order" ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Товар под заказ. Срок поставки уточнит менеджер.
            </p>
          ) : null}

          {product.description ? (
            <p className="text-sm text-slate-700">{product.description}</p>
          ) : null}

          <QuantityStepper
            product={quantity_product}
            qty={qty}
            on_change={set_qty}
          />

          <div className="sticky bottom-20 z-10 flex flex-wrap gap-2 bg-white/95 py-2 md:static md:bottom-auto md:bg-transparent md:py-0">
            <button
              type="button"
              disabled={!allowed || !qty_check.valid || pending}
              onClick={on_add}
              className="rounded-md bg-teal-700 px-4 py-3 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {pending ? "Добавляем…" : "В корзину"}
            </button>
            <Link
              href="/catalog"
              className="rounded-md border border-slate-300 px-4 py-3 text-sm text-slate-800"
            >
              Назад в каталог
            </Link>
          </div>

          <p className="text-xs text-slate-500">
            Цены не отображаются. Менеджер подтвердит условия после оформления
            заказа.
          </p>
        </div>
      </div>
      <Toast message={toast} />
    </>
  );
}
