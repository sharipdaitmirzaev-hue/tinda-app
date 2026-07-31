/** Official sources for Bavaria catalog import / PDF review. */
export const BAVARIA_OFFICIAL_SOURCES = [
  {
    id: "bavaria-group-site",
    name: "Сайт ГК ПД «Бавария»",
    url: "https://www.bavaria-group.ru",
  },
  {
    id: "tbau-site",
    name: "Официальный сайт TBAU",
    url: "https://tbau.ru",
    via: "https://www.bavaria-group.ru (ссылка производителя)",
  },
  {
    id: "bavaria-booklet-2026",
    name: "БУКЛЕТ БАВАРИЯ 2026.pdf",
    url: null as string | null,
    local_paths: [
      "/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf",
      "artifacts/bavaria-import/pdf-source/БУКЛЕТ БАВАРИЯ 2026.pdf",
    ],
    note: "Официальный PDF-буклет производителя; равноправный источник с сайтом",
  },
] as const;

export type PdfEvidenceType = "pdf-text" | "pdf-image" | "pdf-packaging";
