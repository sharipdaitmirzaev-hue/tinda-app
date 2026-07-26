import { Suspense } from "react";
import { CatalogPageClient } from "@/components/catalog/catalog-page-client";

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
        </div>
      }
    >
      <CatalogPageClient />
    </Suspense>
  );
}
