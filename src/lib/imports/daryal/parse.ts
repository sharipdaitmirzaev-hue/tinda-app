import type { Carbonation, DiscoveredVariant, PackageCode } from "./types";

function strip_html(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|h\d|tr|td|section|article)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n+/g, "\n");
  return text.trim();
}

function extract_title(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function quoted_flavors(block: string): string[] {
  const out: string[] = [];
  const re = /[“"«]([^”"»]+)[”"»]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const taste = m[1].replace(/\s+/g, " ").trim();
    if (!taste) continue;
    if (/документы|продукция|живое|контакты/i.test(taste)) continue;
    out.push(taste);
  }
  return out;
}

function section_after(text: string, start_re: RegExp, end_re: RegExp): string {
  const start = text.search(start_re);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end_rel = rest.slice(1).search(end_re);
  return end_rel >= 0 ? rest.slice(0, end_rel + 1) : rest.slice(0, 800);
}

function pkg_label(code: PackageCode): string {
  if (code === "PET") return "ПЭТ";
  if (code === "GLASS") return "стекло";
  if (code === "CAN") return "банка";
  if (code === "KEG") return "кег";
  return "другое";
}

function volume_text_from_ml(ml: number): string {
  if (ml % 1000 === 0) return `${ml / 1000} л`;
  const liters = (ml / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${liters.replace(".", ",")} л`;
}

function make_variant(input: {
  line: DiscoveredVariant["line"];
  brand: string;
  product_name: string;
  taste: string | null;
  carbonation: Carbonation;
  volume_ml: number | null;
  package: PackageCode | null;
  source_url: string;
  source_section: string;
  image_url?: string | null;
  confidence?: DiscoveredVariant["confidence"];
  notes?: string;
  alcohol_scope?: DiscoveredVariant["alcohol_scope"];
}): DiscoveredVariant {
  return {
    line: input.line,
    brand: input.brand,
    product_name: input.product_name,
    taste: input.taste,
    carbonation: input.carbonation,
    volume_ml: input.volume_ml,
    volume_text:
      input.volume_ml != null ? volume_text_from_ml(input.volume_ml) : null,
    package: input.package,
    package_label: input.package ? pkg_label(input.package) : null,
    source_url: input.source_url,
    source_section: input.source_section,
    image_url: input.image_url ?? null,
    alcohol_scope: input.alcohol_scope ?? "non_alcoholic",
    confidence: input.confidence ?? "high",
    notes: input.notes ?? "",
  };
}

/** Parse /sparkling/ into glass/PET flavor × volume variants. */
export function parse_sparkling_page(html: string, source_url: string) {
  const text = strip_html(html);
  const title = extract_title(html);
  const variants: DiscoveredVariant[] = [];
  const manual_gaps: Array<{ reason: string; evidence: string }> = [];

  const glass_block = section_after(
    text,
    /СТЕКЛО\s*0[.,]5/i,
    /Безалкогольные газированные напитки|ПЭТ\s*0[.,]5/i,
  );
  const glass_flavors = quoted_flavors(glass_block);
  if (!glass_flavors.length) {
    manual_gaps.push({
      reason: "no_glass_flavors_parsed",
      evidence: "Expected quoted flavors under СТЕКЛО 0.5 Л",
    });
  }
  for (const taste of glass_flavors) {
    variants.push(
      make_variant({
        line: "gazirovannye",
        brand: "Дарьял",
        product_name: taste,
        taste,
        carbonation: "газированная",
        volume_ml: 500,
        package: "GLASS",
        source_url,
        source_section: "СТЕКЛО 0.5 Л",
      }),
    );
  }

  const pet05_block = section_after(
    text,
    /ПЭТ\s*0[.,]5(?!\s*л\s*и)/i,
    /ПЭТ\s*1[.,]5|Газированные напитки от/i,
  );
  let pet05_flavors = quoted_flavors(pet05_block);
  // Fallback: HTML comments may hide one flavor; merge known visible list from page text
  if (pet05_flavors.length && !pet05_flavors.some((f) => /грейпфрут/i.test(f))) {
    // keep parsed list as-is (commented flavor is not proven live)
  }
  if (!pet05_flavors.length) {
    manual_gaps.push({
      reason: "no_pet_05_flavors_parsed",
      evidence: "Expected quoted flavors under ПЭТ 0,5",
    });
  }
  for (const taste of pet05_flavors) {
    variants.push(
      make_variant({
        line: "gazirovannye",
        brand: "Дарьял",
        product_name: taste,
        taste,
        carbonation: "газированная",
        volume_ml: 500,
        package: "PET",
        source_url,
        source_section: "ПЭТ 0,5",
      }),
    );
  }

  const pet15_block = section_after(
    text,
    /ПЭТ\s*1[.,]5/i,
    /Газированные напитки от|Сладкие газированные/i,
  );
  const pet15_flavors = quoted_flavors(pet15_block);
  if (!pet15_flavors.length) {
    manual_gaps.push({
      reason: "no_pet_15_flavors_parsed",
      evidence: "Expected quoted flavors under ПЭТ 1,5",
    });
  }
  for (const taste of pet15_flavors) {
    variants.push(
      make_variant({
        line: "gazirovannye",
        brand: "Дарьял",
        product_name: taste,
        taste,
        carbonation: "газированная",
        volume_ml: 1500,
        package: "PET",
        source_url,
        source_section: "ПЭТ 1,5",
      }),
    );
  }

  // Surface HTML-commented grapefruit if present but not live
  if (/Грейпфрут-малина/i.test(html) && /<!--[\s\S]*Грейпфрут-малина/i.test(html)) {
    if (!variants.some((v) => /грейпфрут/i.test(v.taste || ""))) {
      manual_gaps.push({
        reason: "flavor_in_html_comment_only",
        evidence: "«Грейпфрут-малина» встречается в HTML-комментарии на /sparkling/",
      });
    }
  }

  void pet05_flavors;
  return { title, text_excerpt: text.slice(0, 500), variants, manual_gaps };
}

/** Parse /water/ Aqua Daryal still + sparkling pack formats. */
export function parse_water_page(html: string, source_url: string) {
  const text = strip_html(html);
  const title = extract_title(html);
  const variants: DiscoveredVariant[] = [];
  const manual_gaps: Array<{ reason: string; evidence: string }> = [];

  const packs: Array<{ volume_ml: number; package: PackageCode; label: string }> =
    [
      { volume_ml: 500, package: "GLASS", label: "СТЕКЛО 0,5Л" },
      { volume_ml: 500, package: "PET", label: "ПЭТ 0,5Л" },
      { volume_ml: 1500, package: "PET", label: "ПЭТ 1,5Л" },
    ];

  const has_still = /негазированн/i.test(text) && /Аква\s*Дарьял/i.test(text);
  const has_sparkling =
    (/газированн/i.test(text) && /Аква\s*Дарьял/i.test(text)) ||
    /AQUADARIAL/i.test(text);

  if (!has_still) {
    manual_gaps.push({
      reason: "still_water_not_confirmed",
      evidence: "Expected «Аква Дарьял» негазированная",
    });
  } else {
    for (const p of packs) {
      variants.push(
        make_variant({
          line: "water",
          brand: "Аква Дарьял",
          product_name: "Аква Дарьял негазированная",
          taste: null,
          carbonation: "негазированная",
          volume_ml: p.volume_ml,
          package: p.package,
          source_url,
          source_section: `негазированная / ${p.label}`,
          confidence: "high",
        }),
      );
    }
  }

  if (!has_sparkling) {
    manual_gaps.push({
      reason: "sparkling_water_not_confirmed",
      evidence: "Expected «Аква Дарьял» газированная",
    });
  } else {
    for (const p of packs) {
      variants.push(
        make_variant({
          line: "water",
          brand: "Аква Дарьял",
          product_name: "Аква Дарьял газированная",
          taste: null,
          carbonation: "газированная",
          volume_ml: p.volume_ml,
          package: p.package,
          source_url,
          source_section: `газированная / ${p.label}`,
          confidence: "high",
        }),
      );
    }
  }

  return { title, text_excerpt: text.slice(0, 500), variants, manual_gaps };
}

/** Parse Frutimix still drinks; volume often missing → manual. */
export function parse_still_juice_page(html: string, source_url: string) {
  const text = strip_html(html);
  const title = extract_title(html);
  const variants: DiscoveredVariant[] = [];
  const manual_gaps: Array<{ reason: string; evidence: string }> = [];

  const tastes: string[] = [];
  if (/Мультифрукт/i.test(text)) tastes.push("Мультифрукт");
  if (/Красный апельсин/i.test(text)) tastes.push("Красный апельсин");

  if (!tastes.length) {
    manual_gaps.push({
      reason: "frutimix_flavors_not_found",
      evidence: "Expected Мультифрукт / Красный апельсин on /negazirovannye-napitki/",
    });
  }

  for (const taste of tastes) {
    variants.push(
      make_variant({
        line: "juice_still",
        brand: "Фрутимикс",
        product_name: `Фрутимикс ${taste}`,
        taste,
        carbonation: "негазированная",
        volume_ml: null,
        package: null,
        source_url,
        source_section: "Фрутимикс",
        confidence: "low",
        notes: "Объём и тара на сайте не указаны — manual review",
      }),
    );
  }

  if (tastes.length) {
    manual_gaps.push({
      reason: "missing_volume_package",
      evidence: "Фрутимикс: вкусы есть, объём/тара не опубликованы на странице",
    });
  }

  return { title, text_excerpt: text.slice(0, 500), variants, manual_gaps };
}

/** Collect alcoholic beer names for exclusion report (not imported). */
export function parse_beer_exclusion(html: string, source_url: string) {
  const text = strip_html(html);
  const names = new Set<string>();
  for (const m of text.matchAll(
    /Дарьял\s*[«"]([^»"]+)[»"]|^(Чешское|Баварское|Немецкое|Царская корона)\b/gim,
  )) {
    const name = (m[1] || m[2] || "").replace(/\s+/g, " ").trim();
    if (name) names.add(name.startsWith("Дарьял") ? name : `Дарьял ${name}`);
  }
  // headings like Дарьял "Оригинальное"
  for (const m of text.matchAll(/Дарьял\s+[«"]([^»"]+)[»"]/g)) {
    names.add(`Дарьял «${m[1].trim()}»`);
  }
  for (const label of [
    "Оригинальное",
    "Традиционное",
    "Жигулевское",
    "Чешское",
    "Баварское",
    "Немецкое",
    "Царская корона",
  ]) {
    if (new RegExp(label, "i").test(text)) names.add(`Пиво Дарьял ${label}`);
  }

  return [...names].sort().map((name) => ({
    name,
    source_url,
    evidence: "Страница /beer/ — алкогольная продукция, вне scope импорта",
  }));
}

export function page_title(html: string): string {
  return extract_title(html);
}
