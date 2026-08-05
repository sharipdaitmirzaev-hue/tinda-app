import type { MetadataRoute } from "next";
import { get_app_url } from "@/lib/security/env";

export default function robots(): MetadataRoute.Robots {
  const base = get_app_url();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/staff/", "/api/", "/checkout/", "/cart", "/orders", "/profile"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base.replace(/^https?:\/\//, ""),
  };
}
