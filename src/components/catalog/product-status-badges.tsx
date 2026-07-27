"use client";

import {
  AVAILABILITY_LABELS,
  SALES_STATUS_LABELS,
  type Availability,
  type SalesStatus,
} from "@/lib/catalog/constants";

export function ProductStatusBadges({
  product,
}: {
  product: {
    is_new?: boolean;
    is_promo?: boolean;
    is_hit?: boolean;
    sales_status?: string;
    availability?: string;
  };
}) {
  const sales = (product.sales_status || "showcase") as SalesStatus;
  const availability = (product.availability || "in_stock") as Availability;

  const badges: Array<{ key: string; label: string; className: string }> = [];

  if (product.is_new) {
    badges.push({
      key: "new",
      label: "Новинка",
      className: "bg-sky-100 text-sky-900",
    });
  }
  if (product.is_promo) {
    badges.push({
      key: "promo",
      label: "Акция",
      className: "bg-rose-100 text-rose-800",
    });
  }
  if (product.is_hit) {
    badges.push({
      key: "hit",
      label: "Хит",
      className: "bg-amber-100 text-amber-900",
    });
  }

  badges.push({
    key: "sales",
    label: SALES_STATUS_LABELS[sales] ?? "Витрина",
    className:
      sales === "orderable"
        ? "bg-teal-100 text-teal-900"
        : sales === "on_request"
          ? "bg-violet-100 text-violet-900"
          : "bg-slate-100 text-slate-700",
  });

  badges.push({
    key: "availability",
    label: AVAILABILITY_LABELS[availability] ?? availability,
    className:
      availability === "out_of_stock"
        ? "bg-red-100 text-red-800"
        : availability === "on_order"
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-900",
  });

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
