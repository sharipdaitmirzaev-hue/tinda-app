"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CatalogProductCard,
  type CatalogProduct,
} from "@/components/catalog/catalog-product-card";
import {
  HOMEPAGE_FEATURED_INITIAL_VISIBLE,
  STILL_WATER_CATEGORY_SLUG,
} from "@/lib/catalog/homepage-featured";

export function HomeFeaturedSection({
  products,
}: {
  products: CatalogProduct[];
}) {
  const [expanded, set_expanded] = useState(false);
  const { visible, hidden_count } = useMemo(() => {
    if (expanded || products.length <= HOMEPAGE_FEATURED_INITIAL_VISIBLE) {
      return { visible: products, hidden_count: 0 };
    }
    return {
      visible: products.slice(0, HOMEPAGE_FEATURED_INITIAL_VISIBLE),
      hidden_count: products.length - HOMEPAGE_FEATURED_INITIAL_VISIBLE,
    };
  }, [expanded, products]);

  if (products.length === 0) return null;

  return (
    <section className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50/80">
      <div className="ui-container py-12 md:py-16">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
            Популярные товары
          </h2>
          <p className="mt-2 text-sm text-slate-600 md:text-base">
            Напитки, которые чаще всего заказывают для магазинов, кафе и
            мероприятий
          </p>
        </div>

        {/* Mobile: horizontal scroll; Desktop: 4-col grid */}
        <div className="mt-8 md:hidden">
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory">
            {visible.map((product) => (
              <div
                key={product.id}
                className="w-[78%] max-w-[280px] shrink-0 snap-start"
              >
                <CatalogProductCard product={product} />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 hidden grid-cols-2 gap-4 md:grid lg:grid-cols-4">
          {visible.map((product) => (
            <CatalogProductCard key={product.id} product={product} />
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {hidden_count > 0 && !expanded ? (
            <button
              type="button"
              onClick={() => set_expanded(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Показать ещё ({hidden_count})
            </button>
          ) : null}
          <Link
            href={`/catalog?category=${STILL_WATER_CATEGORY_SLUG}`}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Вся негазированная вода
          </Link>
        </div>
      </div>
    </section>
  );
}
