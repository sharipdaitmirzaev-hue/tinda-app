"use client";

import { createContext, useContext } from "react";

export type CatalogViewerMode =
  | "guest"
  | "pending"
  | "rejected"
  | "blocked"
  | "approved";

const CatalogViewerContext = createContext<CatalogViewerMode>("guest");

export function CatalogViewerProvider({
  mode,
  children,
}: {
  mode: CatalogViewerMode;
  children: React.ReactNode;
}) {
  return (
    <CatalogViewerContext.Provider value={mode}>
      {children}
    </CatalogViewerContext.Provider>
  );
}

export function useCatalogViewer(): CatalogViewerMode {
  return useContext(CatalogViewerContext);
}

export function format_rub_price(amount: number, unit: string): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} / ${unit}`;
}
