import { redirect } from "next/navigation";
import { get_post_auth_path } from "@/lib/access";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { CatalogViewerProvider } from "@/components/catalog/catalog-viewer-context";
import { PublicCatalogHeader } from "@/components/catalog/public-catalog-chrome";
import { HomeCatalogCta, HomeHero } from "@/components/home/home-hero";
import { HomeFeaturedSection } from "@/components/home/home-featured-section";
import { list_homepage_featured_products } from "@/lib/services/homepage-featured.service";
import type { CatalogProduct } from "@/components/catalog/catalog-product-card";

export default async function HomePage() {
  const payload = await get_current_auth_payload();
  if (payload) {
    redirect(get_post_auth_path(payload));
  }

  const products = (await list_homepage_featured_products(
    null,
  )) as CatalogProduct[];

  return (
    <CatalogViewerProvider mode="guest" can_edit_catalog={false}>
      <div className="min-h-screen bg-white">
        <PublicCatalogHeader />
        <HomeHero />
        <HomeFeaturedSection products={products} />
        <HomeCatalogCta />
      </div>
    </CatalogViewerProvider>
  );
}
