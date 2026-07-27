const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function norm_space(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lower(value: unknown): string {
  return norm_space(value).toLowerCase().replace(/ё/g, "е");
}

export function translit(value: unknown): string {
  const src = lower(value);
  let out = "";
  for (const ch of src) {
    if (CYR_TO_LAT[ch] !== undefined) out += CYR_TO_LAT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\s_-]+/.test(ch)) out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Parse volume text to milliliters, or null. */
export function parse_volume_ml(raw: unknown): number | null {
  const text = lower(raw).replace(/,/g, ".");
  if (!text) return null;
  let m = text.match(/^(\d+(?:\.\d+)?)\s*л(?:\s|$)/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  m = text.match(/^(\d+(?:\.\d+)?)\s*мл(?:\s|$)/i);
  if (m) return Math.round(Number(m[1]));
  m = text.match(/(\d+(?:\.\d+)?)\s*(мл|ml)(?=[^\d]|$)/i);
  if (m) {
    const amount = Number(m[1]);
    // Retail typos like "0,33мл" almost always mean 0.33 л
    if (amount > 0 && amount < 10) return Math.round(amount * 1000);
    return Math.round(amount);
  }
  m = text.match(/(\d+(?:\.\d+)?)\s*(л|l)(?=[^\dа-яa-z]|$)/i);
  if (m) {
    const amount = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === "л" || unit === "l") return Math.round(amount * 1000);
  }
  return null;
}

export function normalize_package(raw: unknown): string {
  const t = lower(raw);
  if (!t) return "";
  if (/(пэт|pet|пластик)/.test(t)) return "pet";
  if (/(стекл|glass)/.test(t)) return "glass";
  if (/(жест|алюм|can|банка|ж\s*\/\s*б|жб)/.test(t)) return "can";
  if (/(упаков)/.test(t)) return "pack";
  return translit(t).replace(/\s+/g, "");
}

export function sugar_free_flag(text: unknown): boolean | null {
  const t = lower(text);
  if (!t) return null;
  if (/(без сахара|зеро|zero|sugar[\s-]?free|no sugar|0 калорий)/.test(t)) {
    return true;
  }
  if (/(classic|original|обычн|классик)/.test(t) && !/(zero|зеро|без сахара)/.test(t)) {
    return false;
  }
  return null;
}

export function tokenize_product_text(value: unknown): string[] {
  const t = translit(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const stop = new Set([
    "napitok",
    "gazirovannyi",
    "gazirovannyy",
    "drink",
    "the",
    "and",
    "i",
    "s",
    "so",
    "vkusom",
  ]);
  return t
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !stop.has(x) && !/^\d+$/.test(x));
}

export function token_overlap(a: unknown, b: unknown): number {
  const aa = new Set(tokenize_product_text(a));
  const bb = new Set(tokenize_product_text(b));
  if (aa.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const t of aa) if (bb.has(t)) inter += 1;
  return inter / Math.max(aa.size, bb.size);
}

export function normalize_brand(value: unknown): string {
  return translit(value).replace(/[^a-z0-9]/g, "");
}

export function extract_flavor_hint(
  name: unknown,
  brand: unknown,
  volume: unknown,
  package_type: unknown,
): string {
  let text = lower(name);
  const brand_l = lower(brand);
  if (brand_l) text = text.replace(brand_l, " ");
  const vol = lower(volume);
  if (vol) text = text.replace(vol, " ");
  const pkg = lower(package_type);
  if (pkg) text = text.replace(pkg, " ");
  text = text
    .replace(/\d+[.,]?\d*\s*(л|мл|l|ml)\b/gi, " ")
    .replace(/\b(пэт|стекло|жестяная банка|банка)\b/gi, " ")
    .replace(/[,\-–—/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}
