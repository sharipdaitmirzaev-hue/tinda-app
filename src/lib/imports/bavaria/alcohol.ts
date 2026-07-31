import type { AlcoholDecision } from "./types";

const NA_MARKERS = [
  /безалкогольн/i,
  /\b0[,.]0\s*%/i,
  /\b0[,.]0\s*%\s*об/i,
  /alcohol\s*free/i,
  /non[-\s]?alcoholic/i,
];

const ALC_PCT =
  /(?:алкоголь|alc\.?|крепкость)\s*[:=]?\s*(\d+([.,]\d+)?)\s*%(?:\s*об\.?)?/i;
const ALC_PCT_LOOSE = /(\d+([.,]\d+)?)\s*%\s*об\.?/i;

function parse_pct(raw: string): number {
  return Number(raw.replace(",", "."));
}

/**
 * Decide alcoholic vs non-alcoholic from official text.
 * Non-alcoholic beer is accepted only with explicit NA markers or ≤ 0.5% ABV.
 */
export function classify_alcohol(
  text: string,
  options: { is_beer_or_cider_context?: boolean } = {},
): AlcoholDecision {
  const blob = text || "";
  const beerish =
    options.is_beer_or_cider_context ||
    /пиво|сидр|lager|bier|эль\b|стаут|портер/i.test(blob);

  const pct_m = blob.match(ALC_PCT) || blob.match(ALC_PCT_LOOSE);
  const alcohol_percent = pct_m ? parse_pct(pct_m[1]) : null;

  const has_na_marker = NA_MARKERS.some((re) => re.test(blob));

  if (has_na_marker) {
    if (alcohol_percent !== null && alcohol_percent > 0.5) {
      return {
        kind: "alcoholic",
        alcohol_percent,
        evidence: `Маркер «безалкогольное», но крепость ${alcohol_percent}% об. > 0,5`,
      };
    }
    return {
      kind: "non_alcoholic",
      alcohol_percent: alcohol_percent ?? 0,
      evidence: has_na_marker
        ? `Явный маркер безалкогольности${
            alcohol_percent !== null ? ` (${alcohol_percent}% об.)` : ""
          }`
        : "NA",
    };
  }

  if (alcohol_percent !== null) {
    if (alcohol_percent <= 0.5) {
      return {
        kind: "non_alcoholic",
        alcohol_percent,
        evidence: `Крепость ${alcohol_percent}% об. ≤ 0,5`,
      };
    }
    return {
      kind: "alcoholic",
      alcohol_percent,
      evidence: `Крепость ${alcohol_percent}% об. > 0,5`,
    };
  }

  if (beerish) {
    return {
      kind: "unknown",
      alcohol_percent: null,
      evidence:
        "Пивной/сидровый контекст без явного «безалкогольное»/0,0%/≤0,5% об.",
    };
  }

  // Soft drinks / water / tea / energy without ABV → treat as non-alcoholic.
  if (
    /вод[аы]|лимонад|напитк|тоник|кол[аы]|квас|чай|энерг|газир|негазир|mountea|dreamix|rocket|tbau|тбау|premium|orange|мохито|swipe|лимнад|ретро|хонг/i.test(
      blob,
    )
  ) {
    return {
      kind: "non_alcoholic",
      alcohol_percent: null,
      evidence: "Безалкогольная категория без указания крепости",
    };
  }

  // Private-label soft drinks on STM pages without ABV: still non-alcoholic if packaging looks like a soft drink.
  if (
    /пэт|стекл|жб|банк/.test(blob) &&
    !/пиво|сидр|bier|lager/i.test(blob)
  ) {
    return {
      kind: "non_alcoholic",
      alcohol_percent: null,
      evidence: "Фасовка напитка без признаков алкоголя",
    };
  }

  return {
    kind: "unknown",
    alcohol_percent: null,
    evidence: "Недостаточно данных для надёжного определения крепости",
  };
}

export function is_beer_category_path(paths: string[]): boolean {
  return paths.some((p) => /pivo-i-sidr|beer-category\/pivo/i.test(p));
}
