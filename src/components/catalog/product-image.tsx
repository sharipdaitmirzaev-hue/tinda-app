"use client";

import { useEffect, useState } from "react";

export const PRODUCT_IMAGE_PLACEHOLDER = "/images/product-placeholder.svg";

export function ProductImage({
  src,
  alt,
  className = "h-16 w-16",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, set_failed] = useState(false);
  const show_placeholder = !src || failed;

  useEffect(() => {
    set_failed(false);
  }, [src]);

  if (show_placeholder) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={PRODUCT_IMAGE_PLACEHOLDER}
        alt={alt || "Нет фото"}
        className={`${className} rounded-md object-cover bg-slate-100`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} rounded-md object-cover bg-slate-100`}
      onError={() => set_failed(true)}
    />
  );
}
