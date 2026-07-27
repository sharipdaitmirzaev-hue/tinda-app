"use client";

import { useEffect, useState } from "react";

export const PRODUCT_IMAGE_PLACEHOLDER = "/images/product-placeholder.svg";

export function ProductImage({
  src,
  alt,
  className = "h-16 w-16",
  priority = false,
  object_fit = "cover",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** When true, load eagerly (detail hero). Cards use lazy by default. */
  priority?: boolean;
  object_fit?: "cover" | "contain";
}) {
  const [failed, set_failed] = useState(false);
  const show_placeholder = !src || failed;
  const fit_class = object_fit === "contain" ? "object-contain" : "object-cover";

  useEffect(() => {
    set_failed(false);
  }, [src]);

  if (show_placeholder) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={PRODUCT_IMAGE_PLACEHOLDER}
        alt={alt || "Нет фото"}
        className={`${className} rounded-md ${fit_class} bg-slate-100`}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} rounded-md ${fit_class} bg-slate-100`}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => set_failed(true)}
    />
  );
}
