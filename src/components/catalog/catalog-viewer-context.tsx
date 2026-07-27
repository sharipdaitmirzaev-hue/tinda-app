"use client";

import { createContext, useContext } from "react";

export type CatalogViewerMode =
  | "guest"
  | "pending"
  | "rejected"
  | "blocked"
  | "approved"
  | "staff";

type CatalogViewerContextValue = {
  mode: CatalogViewerMode;
  can_edit_catalog: boolean;
};

const CatalogViewerContext = createContext<CatalogViewerContextValue>({
  mode: "guest",
  can_edit_catalog: false,
});

export function CatalogViewerProvider({
  mode,
  can_edit_catalog = false,
  children,
}: {
  mode: CatalogViewerMode;
  can_edit_catalog?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CatalogViewerContext.Provider value={{ mode, can_edit_catalog }}>
      {children}
    </CatalogViewerContext.Provider>
  );
}

export function useCatalogViewer(): CatalogViewerMode {
  return useContext(CatalogViewerContext).mode;
}

export function useCanEditCatalog(): boolean {
  return useContext(CatalogViewerContext).can_edit_catalog;
}

export function format_rub_price(amount: number, unit: string): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} / ${unit}`;
}
