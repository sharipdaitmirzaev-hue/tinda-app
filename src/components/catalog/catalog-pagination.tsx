"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  buildCatalogPageHref,
  formatCatalogResultsRange,
  getPaginationItems,
} from "@/lib/catalog/pagination";

export type CatalogPaginationProps = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  search_params: Pick<URLSearchParams, "get">;
  /** Visual density: top bar is slightly more compact on desktop. */
  placement?: "top" | "bottom";
  /** Show mobile «Показать ещё» (next page) under the pager. */
  show_load_more?: boolean;
  disabled?: boolean;
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function CatalogPagination({
  page,
  page_size,
  total,
  total_pages,
  search_params,
  placement = "bottom",
  show_load_more = false,
  disabled = false,
  className,
}: CatalogPaginationProps) {
  const items = useMemo(
    () => getPaginationItems(page, total_pages),
    [page, total_pages],
  );

  const range_text = formatCatalogResultsRange({
    page,
    pageSize: page_size,
    total,
  });

  const href_for = (target: number) =>
    buildCatalogPageHref(search_params, target);

  const at_start = page <= 1 || total_pages <= 0;
  const at_end = total_pages <= 0 || page >= total_pages;
  const has_pages = total_pages > 0 && total > 0;

  return (
    <div
      className={cn(
        "space-y-3 text-sm text-slate-600",
        placement === "top" && "hidden md:block",
        className,
      )}
    >
      <p
        className={cn(
          "text-sm text-slate-600",
          placement === "top" && "md:text-xs",
        )}
        data-testid="catalog-results-range"
      >
        {range_text}
      </p>

      {has_pages ? (
        <nav
          aria-label="Пагинация каталога"
          className="flex flex-col gap-3"
          data-testid={`catalog-pagination-${placement}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href_for(1)}
              aria-label="В начало"
              aria-disabled={at_start || disabled || undefined}
              tabIndex={at_start || disabled ? -1 : undefined}
              className={cn(
                "hidden min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:inline-flex",
                (at_start || disabled) &&
                  "pointer-events-none opacity-40",
              )}
              scroll
            >
              В начало
            </Link>

            {at_start || disabled ? (
              <span
                aria-disabled="true"
                className="inline-flex min-h-10 cursor-not-allowed items-center rounded-md border border-slate-200 px-3 py-1.5 opacity-40"
              >
                Назад
              </span>
            ) : (
              <Link
                href={href_for(page - 1)}
                aria-label="Предыдущая страница"
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                scroll
              >
                Назад
              </Link>
            )}

            <div
              className={cn(
                "flex max-w-full items-center gap-1",
                "overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                "md:overflow-visible md:pb-0",
              )}
              role="list"
            >
              {items.map((item) => {
                if (item.type === "ellipsis") {
                  return (
                    <span
                      key={item.id}
                      role="presentation"
                      className="inline-flex min-h-10 min-w-9 items-center justify-center px-1 text-slate-400"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  );
                }

                const is_current = item.page === page;
                return (
                  <Link
                    key={`p-${item.page}`}
                    href={href_for(item.page)}
                    role="listitem"
                    aria-label={`Страница ${item.page}`}
                    aria-current={is_current ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md border px-2.5 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700",
                      is_current
                        ? "border-teal-800 bg-teal-800 text-white"
                        : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
                      disabled && !is_current && "pointer-events-none opacity-40",
                    )}
                    scroll
                    tabIndex={disabled && !is_current ? -1 : undefined}
                  >
                    {item.page}
                  </Link>
                );
              })}
            </div>

            {at_end || disabled ? (
              <span
                aria-disabled="true"
                className="inline-flex min-h-10 cursor-not-allowed items-center rounded-md border border-slate-200 px-3 py-1.5 opacity-40"
              >
                Вперёд
              </span>
            ) : (
              <Link
                href={href_for(page + 1)}
                aria-label="Следующая страница"
                className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                scroll
              >
                Вперёд
              </Link>
            )}

            <Link
              href={href_for(Math.max(total_pages, 1))}
              aria-label="В конец"
              aria-disabled={at_end || disabled || undefined}
              tabIndex={at_end || disabled ? -1 : undefined}
              className={cn(
                "hidden min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:inline-flex",
                (at_end || disabled) && "pointer-events-none opacity-40",
              )}
              scroll
            >
              В конец
            </Link>
          </div>

          {show_load_more && !at_end ? (
            <Link
              href={href_for(page + 1)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 md:hidden"
              scroll
            >
              Показать ещё
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
