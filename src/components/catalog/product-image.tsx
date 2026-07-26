"use client";

import { useState } from "react";

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

  if (show_placeholder) {
    return (
      <div
        className={`${className} flex items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-500`}
      >
        Нет фото
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} rounded-md object-cover`}
      onError={() => set_failed(true)}
    />
  );
}
