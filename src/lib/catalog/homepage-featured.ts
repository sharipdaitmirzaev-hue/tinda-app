/**
 * Homepage «Популярные товары» showcase configuration.
 * SKUs / category groups only — no hardcoded product cards in JSX.
 * Inactive products are filtered out at resolve time.
 */

export const HOMEPAGE_FEATURED_INITIAL_VISIBLE = 16;

export const STILL_WATER_CATEGORY_SLUG = "voda-negazirovannaya";

/** Known still-water brands first (lowercase substrings). */
export const STILL_WATER_KNOWN_BRANDS = [
  "архыз",
  "аква",
  "sabr",
  "мевер",
  "серноводская",
  "шишкин",
  "родники",
  "родниковая",
  "легенда",
  "нагутти",
  "три",
  "тинда",
] as const;

export type HomepageFeaturedEntry =
  | {
      type: "sku";
      sku: string;
      group:
        | "coca_cola"
        | "coca_cola_zero"
        | "sprite"
        | "borjomi"
        | "rychal"
        | "viko"
        | "adrenaline_small"
        | "adrenaline_large";
    }
  | {
      type: "category";
      slug: string;
      group: "still_water";
      /** Exclude these category slugs if a parent tree is ever used. */
      exclude_slugs?: string[];
    };

/**
 * Display order for «Популярные товары».
 * Missing/inactive SKUs are omitted at resolve time.
 * Borjomi: both glass volumes listed (no silent single pick).
 * Adrenaline 0.33 is intentionally not listed.
 */
export const HOMEPAGE_FEATURED_ENTRIES: HomepageFeaturedEntry[] = [
  { type: "sku", sku: "DRINK-COCACOLA-330-GLASS-105", group: "coca_cola" },
  { type: "sku", sku: "ZY-COCACOLAZERO-330-GLASS-001", group: "coca_cola_zero" },
  { type: "sku", sku: "ZY-SPRITE-2000-PET-001", group: "sprite" },
  { type: "sku", sku: "ZY-BORZHOMI-500-GLASS-001", group: "borjomi" },
  { type: "sku", sku: "ZY-BORZHOMI-330-GLASS-001", group: "borjomi" },
  { type: "sku", sku: "ZY-MIN-500-GLASS-001", group: "rychal" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-012", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-013", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-009", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-006", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-004", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-002", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-001", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-008", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-010", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-003", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-005", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-007", group: "viko" },
  { type: "sku", sku: "ZY-VIKO-1000-CARTON-011", group: "viko" },
  { type: "sku", sku: "ZY-ADRENALINE-250-CAN-001", group: "adrenaline_small" },
  { type: "sku", sku: "ZY-ADRENALINE-449-CAN-001", group: "adrenaline_large" },
  {
    type: "category",
    slug: STILL_WATER_CATEGORY_SLUG,
    group: "still_water",
    exclude_slugs: [
      "voda-gazirovannaya",
      "voda-lechebno-stolovaya",
      "voda-mineralnaya",
    ],
  },
];

export type FeaturedProductLike = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  is_active: boolean;
  category_slug?: string | null;
};

export function collect_featured_skus(
  entries: HomepageFeaturedEntry[] = HOMEPAGE_FEATURED_ENTRIES,
): string[] {
  return entries
    .filter((e): e is Extract<HomepageFeaturedEntry, { type: "sku" }> => e.type === "sku")
    .map((e) => e.sku);
}

export function collect_featured_category_slugs(
  entries: HomepageFeaturedEntry[] = HOMEPAGE_FEATURED_ENTRIES,
): string[] {
  return entries
    .filter(
      (e): e is Extract<HomepageFeaturedEntry, { type: "category" }> =>
        e.type === "category",
    )
    .map((e) => e.slug);
}

function still_water_brand_rank(brand: string | null): number {
  const b = (brand || "").toLowerCase();
  const idx = STILL_WATER_KNOWN_BRANDS.findIndex((k) => b.includes(k));
  return idx === -1 ? 1000 : idx;
}

function parse_volume_ml(volume_text: string | null): number {
  if (!volume_text) return 0;
  const t = volume_text.toLowerCase().replace(",", ".");
  const ml = t.match(/(\d+(?:\.\d+)?)\s*мл/);
  if (ml) return Math.round(Number(ml[1]));
  const l = t.match(/(\d+(?:\.\d+)?)\s*л/);
  if (l) return Math.round(Number(l[1]) * 1000);
  return 0;
}

export function sort_still_water_products<T extends FeaturedProductLike>(
  products: T[],
): T[] {
  return [...products].sort((a, b) => {
    const br = still_water_brand_rank(a.brand) - still_water_brand_rank(b.brand);
    if (br !== 0) return br;
    const name = (a.name || "").localeCompare(b.name || "", "ru");
    if (name !== 0) return name;
    return parse_volume_ml(a.volume_text) - parse_volume_ml(b.volume_text);
  });
}

/** Normalize VIKO flavor key from product name for dedupe. */
export function viko_flavor_key(name: string): string {
  return name
    .toLowerCase()
    .replace(/сок|нектар|вико|viko/gi, " ")
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupe_viko_by_flavor<T extends FeaturedProductLike>(
  products: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of products) {
    const key = viko_flavor_key(p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Build ordered featured list from loaded products.
 * Skips missing SKUs and inactive rows; never invents products.
 * VIKO duplicates by flavor are collapsed if config lists them.
 */
export function resolve_homepage_featured_products<T extends FeaturedProductLike>(
  options: {
    entries?: HomepageFeaturedEntry[];
    by_sku: Map<string, T>;
    by_category_slug: Map<string, T[]>;
  },
): T[] {
  const entries = options.entries ?? HOMEPAGE_FEATURED_ENTRIES;
  const out: T[] = [];
  const seen_ids = new Set<string>();
  const seen_viko_flavors = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "sku") {
      const product = options.by_sku.get(entry.sku);
      if (!product || !product.is_active) continue;
      if (seen_ids.has(product.id)) continue;
      if (entry.group === "viko") {
        const flavor = viko_flavor_key(product.name);
        if (seen_viko_flavors.has(flavor)) continue;
        seen_viko_flavors.add(flavor);
      }
      seen_ids.add(product.id);
      out.push(product);
      continue;
    }

    const raw = options.by_category_slug.get(entry.slug) || [];
    const exclude = new Set(entry.exclude_slugs || []);
    const filtered = raw.filter(
      (p) =>
        p.is_active &&
        !exclude.has(String(p.category_slug || "")) &&
        String(p.category_slug || "") === entry.slug,
    );
    for (const p of sort_still_water_products(filtered)) {
      if (seen_ids.has(p.id)) continue;
      seen_ids.add(p.id);
      out.push(p);
    }
  }

  return out;
}

export function split_initial_featured<T>(
  products: T[],
  initial = HOMEPAGE_FEATURED_INITIAL_VISIBLE,
): { initial: T[]; rest: T[] } {
  return {
    initial: products.slice(0, initial),
    rest: products.slice(initial),
  };
}
