/** Official sources for Daryal (ВПБЗ «Дарьял») catalog import. */
export const DARYAL_OFFICIAL_SOURCES = [
  {
    id: "darialgroup-site",
    name: "Официальный сайт ООО ВПБЗ «Дарьял»",
    url: "https://darialgroup.ru",
  },
  {
    id: "darialgroup-sparkling",
    name: "Сладкие газированные напитки",
    url: "https://darialgroup.ru/sparkling/",
    scope: "non_alcoholic",
  },
  {
    id: "darialgroup-water",
    name: "Питьевая вода «Аква Дарьял»",
    url: "https://darialgroup.ru/water/",
    scope: "non_alcoholic",
  },
  {
    id: "darialgroup-juice-still",
    name: "Негазированные / сокосодержащие (Фрутимикс)",
    url: "https://darialgroup.ru/negazirovannye-napitki/",
    scope: "non_alcoholic",
  },
  {
    id: "darialgroup-beer",
    name: "Живое пиво (исключается из импорта)",
    url: "https://darialgroup.ru/beer/",
    scope: "alcoholic_excluded",
  },
  {
    id: "daryal-pdf-catalog",
    name: "PDF-каталог / прайс производителя (если будет предоставлен)",
    url: null as string | null,
    local_paths: [
      "artifacts/daryal-import/pdf-source/DARYAL-CATALOG.pdf",
      "/mnt/data/DARYAL-CATALOG.pdf",
    ],
    note: "Сейчас отсутствует; scope stage2 — только официальный сайт darialgroup.ru",
  },
] as const;

/** Category landing pages used for non-alcoholic discover. */
export const DARYAL_DISCOVER_PAGES = [
  {
    id: "sparkling",
    path: "/sparkling/",
    url: "https://darialgroup.ru/sparkling/",
    line: "gazirovannye",
  },
  {
    id: "water",
    path: "/water/",
    url: "https://darialgroup.ru/water/",
    line: "water",
  },
  {
    id: "still-juice",
    path: "/negazirovannye-napitki/",
    url: "https://darialgroup.ru/negazirovannye-napitki/",
    line: "juice_still",
  },
] as const;

export const DARYAL_EXCLUDED_PAGES = [
  {
    id: "beer",
    path: "/beer/",
    url: "https://darialgroup.ru/beer/",
    reason: "alcoholic_beer",
  },
] as const;
