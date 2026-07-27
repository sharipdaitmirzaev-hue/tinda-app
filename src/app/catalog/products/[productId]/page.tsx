import { ProductDetailClient } from "@/components/catalog/product-detail-client";

type PageProps = { params: Promise<{ productId: string }> };

export default async function CatalogProductPage({ params }: PageProps) {
  const { productId } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-4 pb-24 md:pb-8">
      <ProductDetailClient product_id={productId} />
    </main>
  );
}
