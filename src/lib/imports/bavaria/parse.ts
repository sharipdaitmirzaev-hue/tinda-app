import type { DiscoveredProduct, RawSliderVariant } from "./types";

function clean_text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extract_product_links(html: string): string[] {
  const links = new Set<string>();
  const re = /href=["'](\/beer-product\/[^"'?#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    links.add(m[1].replace(/\/$/, ""));
  }
  return [...links].sort();
}

export function extract_category_links(html: string): string[] {
  const links = new Set<string>();
  const re = /href=["'](\/beer-category\/[^"'?#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) links.add(m[1]);
  return [...links].sort();
}

export function parse_product_page(
  html: string,
  meta: { path: string; url: string; source_categories: string[] },
): DiscoveredProduct {
  const title =
    clean_text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "") || meta.path;
  const header =
    clean_text(
      html.match(/class="title title_2">\s*([\s\S]*?)\s*<\/div>/i)?.[1] || "",
    ) || title;

  const variants: RawSliderVariant[] = [];
  const block_re =
    /<div class="beer_product_slider_item">([\s\S]*?)(?=<div class="beer_product_slider_item">|<div class="clr")/gi;
  let bm: RegExpExecArray | null;
  while ((bm = block_re.exec(html))) {
    const b = bm[1];
    const img = b.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || null;
    const vt = clean_text(b.match(/<div class="title">\s*([\s\S]*?)\s*<\/div>/i)?.[1] || "");
    const text_html = b.match(/<div class="text text_1">([\s\S]*?)<\/div>/i)?.[1] || "";
    variants.push({
      variant_title: vt,
      text_html,
      text: clean_text(text_html),
      image: img
        ? img.startsWith("http")
          ? img
          : `https://www.bavaria-group.ru${img}`
        : null,
    });
  }

  if (!variants.length) {
    const imgs = [...html.matchAll(/src=["'](\/files\/beer_items\/[^"']+)["']/gi)].map(
      (m) => `https://www.bavaria-group.ru${m[1]}`,
    );
    variants.push({
      variant_title: header,
      text_html: "",
      text: "",
      image: imgs[0] || null,
    });
  }

  return {
    path: meta.path,
    url: meta.url,
    slug: meta.path.split("/").filter(Boolean).pop() || meta.path,
    source_categories: meta.source_categories,
    official_name: header,
    page_title: title,
    variants,
  };
}
