#!/usr/bin/env node
/**
 * METRO draft cleanup → TINDA review workbook.
 *
 * Does NOT write to production DB.
 * Does NOT download images to disk/VPS storage.
 * Does NOT copy metro_price into price_amount.
 *
 * Input:  data/imports/metro_gazirovannye_napitki.xlsx  (unchanged)
 * Output: data/imports/metro_gazirovannye_napitki_review.xlsx
 *         data/imports/metro_test_batch_50.xlsx
 *         data/imports/metro_cleanup_report.md
 *         data/imports/metro_undefined_package_material.xlsx
 *
 * Usage:
 *   node scripts/metro-cleanup-review.mjs
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IMPORTS = path.join(ROOT, "data", "imports");
const SOURCE_XLSX = path.join(IMPORTS, "metro_gazirovannye_napitki.xlsx");

const IMAGE_DELAY_MS = Number(process.env.METRO_IMAGE_CHECK_DELAY_MS || 350);
const IMAGE_CHECK_LIMIT = Number(process.env.METRO_IMAGE_CHECK_LIMIT || 0); // 0 = all

const ALLOWED_PACKAGE_TYPES = [
  "ПЭТ",
  "стекло",
  "жестяная банка",
  "пластиковая бутылка",
  "упаковка",
  "штука",
  "другое",
];

const ALLOWED_CATEGORIES = [
  "gazirovannye-napitki",
  "limonady",
  "toniki",
  "kola",
  "energetiki",
  "drugoe",
];

const BRAND_CODE_OVERRIDES = {
  "COCA-COLA": "COCACOLA",
  "ЧЕРНОГОЛОВКА": "CHERNOGOLOVKA",
  "ДОБРЫЙ": "DOBRYI",
  "НАТАХТАРИ": "NATAKHTARI",
  "АБРАУ ДЮРСО": "ABRAUDYURSO",
  "FRESH BAR": "FRESHBAR",
  "STAR BAR": "STARBAR",
  "LAIMON FRESH": "LAIMONFRESH",
  "COOL COLA": "COOLCOLA",
  "МОХИТО": "MOHITO",
  "РЕКА": "REKA",
  "LOTTE": "LOTTE",
  "RIOBA": "RIOBA",
  "AZIANO": "AZIANO",
  "EVERVESS": "EVERVESS",
  "RICH": "RICH",
  "CHILLOUT": "CHILLOUT",
  "FRUSTYLE": "FRUSTYLE",
  "RIDE": "RIDE",
  "LAPOCHKA": "LAPOCHKA",
  "STREET": "STREET",
  "FANTA": "FANTA",
  "SPRITE": "SPRITE",
  "SCHWEPPES": "SCHWEPPES",
};

const CYR_TO_LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm_space(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return norm_space(value).toLowerCase().replace(/ё/g, "е");
}

function translit_code(text) {
  const src = lower(text);
  let out = "";
  for (const ch of src) {
    if (CYR_TO_LAT[ch] !== undefined) out += CYR_TO_LAT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\s_-]+/.test(ch)) out += "";
  }
  return out.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "BRAND";
}

function brand_code(brand) {
  const key = norm_space(brand).toUpperCase();
  if (BRAND_CODE_OVERRIDES[key]) return BRAND_CODE_OVERRIDES[key];
  return translit_code(brand);
}

function package_code(package_type) {
  switch (package_type) {
    case "ПЭТ":
      return "PET";
    case "стекло":
      return "GLASS";
    case "жестяная банка":
      return "CAN";
    case "пластиковая бутылка":
      return "PLASTIC";
    case "упаковка":
      return "PACK";
    case "штука":
      return "UNIT";
    case "другое":
      return "OTHER";
    default:
      return "UNK";
  }
}

/** Parse volume → milliliters integer, or null. */
function parse_volume_ml(raw) {
  const text = norm_space(raw).toLowerCase().replace(",", ".");
  let m = text.match(/^(\d+(?:\.\d+)?)\s*л$/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  m = text.match(/^(\d+(?:\.\d+)?)\s*мл$/i);
  if (m) return Math.round(Number(m[1]));
  m = text.match(/(\d+(?:\.\d+)?)\s*(л|мл)\b/i);
  if (!m) {
    // Cyrillic without word boundary
    m = text.match(/(\d+(?:\.\d+)?)\s*(мл|л)(?![а-яa-z])/i);
  }
  if (!m) return null;
  const amount = Number(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  if (unit === "л" || unit === "l") return Math.round(amount * 1000);
  return Math.round(amount);
}

/** Normalize to Russian catalog volume text, e.g. "0,33 л", "1 л", "1,5 л". */
function normalize_volume_text(raw, source_name) {
  let ml = parse_volume_ml(raw);
  if (ml === null) ml = parse_volume_ml(extract_volume_from_name(source_name));
  if (ml === null || !Number.isFinite(ml) || ml <= 0) return { volume_text: "", volume_ml: null };

  // Prefer liters for >= 100 ml display consistency with examples (0,33 л).
  const liters = ml / 1000;
  let text;
  if (ml % 1000 === 0) {
    text = `${ml / 1000} л`;
  } else {
    // trim trailing zeros but keep comma decimal separator
    let s = liters.toFixed(3).replace(/\.?0+$/, "");
    s = s.replace(".", ",");
    text = `${s} л`;
  }
  return { volume_text: text, volume_ml: ml };
}

function extract_volume_from_name(name) {
  const text = norm_space(name);
  const multipack = text.match(
    /(\d+(?:[.,]\d+)?)\s*(мл|л|ml|l)\s*[xх×]\s*\d+\s*шт/i,
  );
  if (multipack) return `${multipack[1]}${multipack[2]}`;
  const plain = text.match(/(\d+(?:[.,]\d+)?)\s*(мл|л|ml|l)(?![а-яёa-z])/i);
  if (plain) return `${plain[1]}${plain[2]}`;
  return "";
}

function extract_units(name, existing) {
  const text = norm_space(name);
  const patterns = [
    /[xх×]\s*(\d+)\s*шт/i,
    /(\d+)\s*шт(?:\.|\b)/i,
    /(\d+)\s*[xх×]\s*\d+(?:[.,]\d+)?\s*(?:л|мл)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) {
        return {
          units: n,
          evidence: m[0],
          assumed: false,
        };
      }
    }
  }
  const from_existing = Number(existing);
  if (Number.isInteger(from_existing) && from_existing > 1) {
    return { units: from_existing, evidence: `source units_per_package=${from_existing}`, assumed: false };
  }
  return {
    units: 1,
    evidence: "",
    assumed: true,
  };
}

function detect_package_type(row) {
  const name = lower(row.source_name);
  const url = lower(row.source_url || "");
  const slug = url.split("/").pop() || "";
  const hay = `${name} ${slug} ${lower(row.package_type)}`;
  const reasons = [];

  const sure_can =
    /жб|ж\/б|жестя|алюмин|\bcan\b|zhb/.test(hay) ||
    hay.includes("zhb");
  const sure_glass =
    /стекл|steklo/.test(hay) ||
    /(?:^|[-_])st(?:eklo)?(?:[-_]|$)/.test(slug);
  const sure_pet =
    /\bpet\b|пэт|пэт/.test(hay) ||
    hay.includes("-pet") ||
    hay.includes("_pet");

  // Explicit current mapped values from draft
  if (row.package_type === "жестяная банка" || sure_can) {
    reasons.push(sure_can ? "маркер банки в name/url" : "package_type=жестяная банка");
    return { package_type: "жестяная банка", confidence: "high", reasons };
  }
  if (row.package_type === "стекло" || sure_glass) {
    reasons.push(sure_glass ? "маркер стекла в name/url" : "package_type=стекло");
    return { package_type: "стекло", confidence: "high", reasons };
  }
  if (row.package_type === "PET" || row.package_type === "ПЭТ" || sure_pet) {
    reasons.push(sure_pet ? "маркер PET/ПЭТ в name/url" : "package_type=PET");
    return { package_type: "ПЭТ", confidence: "high", reasons };
  }

  // Ambiguous draft values
  if (row.package_type === "шт" || row.package_type === "упаковка") {
    return {
      package_type: "требует проверки",
      confidence: "low",
      reasons: [`исходный package_type=${row.package_type} без материала`],
      undefined_material: true,
    };
  }

  return {
    package_type: "требует проверки",
    confidence: "low",
    reasons: ["материал упаковки не определён"],
    undefined_material: true,
  };
}

function display_package_for_name(package_type) {
  switch (package_type) {
    case "ПЭТ":
      return "ПЭТ";
    case "стекло":
      return "стекло";
    case "жестяная банка":
      return "жестяная банка";
    case "пластиковая бутылка":
      return "пластиковая бутылка";
    default:
      return "";
  }
}

function normalize_brand(brand, source_name) {
  let b = norm_space(brand);
  if (!b) {
    // do not invent — leave empty
    return "";
  }
  const map = {
    "COCA-COLA": "Coca-Cola",
    "ДОБРЫЙ": "Добрый",
    "ЧЕРНОГОЛОВКА": "Черноголовка",
    "НАТАХТАРИ": "Натахтари",
    "EVERVESS": "Evervess",
    "RICH": "Rich",
    "AZIANO": "Aziano",
    "CHILLOUT": "Chillout",
    "FRESH BAR": "Fresh Bar",
    "STAR BAR": "Star Bar",
    "FRUSTYLE": "Frustyle",
    "LAIMON FRESH": "Laimon Fresh",
    "COOL COLA": "Cool Cola",
    "АБРАУ ДЮРСО": "Абрау-Дюрсо",
    "МОХИТО": "Мохито",
    "РЕКА": "Река",
    "STREET": "Street",
    "RIOBA": "Rioba",
    "LOTTE": "Lotte",
    "RIDE": "Ride",
    "LAPOCHKA": "Lapochka",
    FANTA: "Fanta",
    SPRITE: "Sprite",
    SCHWEPPES: "Schweppes",
  };
  const key = b.toUpperCase();
  if (map[key]) return map[key];
  // Title-ish for latin brands already mixed
  return b;
}

function strip_noise_phrases(text) {
  let out = ` ${norm_space(text)} `;
  const phrases = [
    "сильногазированный",
    "сильногазированная",
    "газированный",
    "газированная",
    "газированные",
    "безалкогольный",
    "безалкогольная",
    "напиток",
    "metro",
    "premium",
    "original taste",
    "со вкусом",
  ];
  for (const w of phrases) {
    out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  return norm_space(out);
}

function extract_flavor(source_name, brand) {
  let text = norm_space(source_name);
  // strip leading "Напиток" / "Напиток газированный"
  text = text.replace(/^напиток\s+/i, "");
  text = strip_noise_phrases(text);
  // remove brand occurrences
  const brand_raw = norm_space(brand);
  if (brand_raw) {
    const re = new RegExp(brand_raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    text = text.replace(re, " ");
  }
  // remove volume and multipack tails
  text = text.replace(
    /,?\s*\d+(?:[.,]\d+)?\s*(?:мл|л)\s*(?:[xх×]\s*\d+\s*шт)?.*$/i,
    "",
  );
  text = text.replace(/\s*\d+(?:[.,]\d+)?\s*(?:мл|л)\s*(?:[xх×]\s*\d+\s*шт)?/gi, " ");
  text = strip_noise_phrases(text);
  text = norm_space(text).replace(/^[,.\-–—]+|[,.\-–—]+$/g, "").trim();

  const sugar_free = /без сахара|\bzero\b|zero sugar|б\/с/i.test(source_name);

  let flavor = text;
  flavor = flavor.replace(/cola/gi, "Кола");
  flavor = flavor.replace(/кола/gi, "Кола");
  if (/original/i.test(source_name) && /coca/i.test(`${brand} ${source_name}`)) {
    flavor = sugar_free ? "Zero" : "Original Taste";
  } else if (sugar_free && flavor) {
    if (!/без сахара|zero/i.test(flavor)) flavor = `${flavor} без сахара`;
  } else if (sugar_free && !flavor) {
    flavor = "без сахара";
  }

  flavor = norm_space(flavor)
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/g, "");

  if (brand_raw && lower(flavor) === lower(brand_raw)) flavor = "";
  // drop leftover "original" alone when already handled
  if (/^original$/i.test(flavor)) flavor = "Original Taste";

  return flavor;
}

function build_tinda_name({ brand, flavor, volume_text, package_type }) {
  const parts = [];
  if (brand) parts.push(brand);
  if (flavor) parts.push(flavor);
  let name = parts.join(" ");
  // cleanup double spaces
  name = norm_space(name);
  const pack_label = display_package_for_name(package_type);
  const tail = [];
  if (volume_text) tail.push(volume_text);
  if (pack_label) tail.push(pack_label);
  if (tail.length) {
    name = name ? `${name}, ${tail.join(", ")}` : tail.join(", ");
  }
  // final polish
  name = name
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name;
}

function assign_category({ source_name, brand, flavor, metro_category_slug }) {
  const hay = lower(`${source_name} ${brand} ${flavor}`);
  const reasons = [];

  // Energy drinks
  if (/энергет|energy|burn|red bull|adrenaline|flash up|tornado/i.test(hay)) {
    reasons.push("признаки энергетика");
    return { category_slug: "energetiki", reasons, ok: true };
  }

  // Tonic
  if (
    /тоник|tonic|индиан тоник|indian tonic|bitter lemon/.test(hay) ||
    metro_category_slug === "tonik"
  ) {
    reasons.push("тоник");
    return { category_slug: "toniki", reasons, ok: true };
  }

  // Cola family
  if (
    /\bкола\b|\bcola\b|coca-cola|добрый кола|cool cola|черноголовка cola/.test(hay)
  ) {
    reasons.push("кола");
    return { category_slug: "kola", reasons, ok: true };
  }

  // Lemonades / flavored sodas
  if (
    /лимонад|лимон|апельсин|мандарин|тархун|дюшес|барбарис|мохито|груша|фейхоа|вишня|малина|спрайт|fanta|sprite|лимонад/.test(
      hay,
    )
  ) {
    reasons.push("лимонад/вкусовой газированный");
    return { category_slug: "limonady", reasons, ok: true };
  }

  // Generic carbonated
  if (/газир|soda|напиток/.test(hay) || metro_category_slug === "napitki-105003") {
    reasons.push("общая газировка");
    return { category_slug: "gazirovannye-napitki", reasons, ok: true };
  }

  reasons.push("категория не определена однозначно");
  return { category_slug: "drugoe", reasons, ok: false };
}

function is_probably_excluded(row) {
  const hay = lower(row.source_name);
  const reasons = [];
  if (/алкогол|вино|шампан|пиво|сидр|коктейль drinksome/.test(hay)) {
    reasons.push("алкоголь/коктейль вне ассортимента газировки");
  }
  if (/нектар|сок(?!а)|морс|холодный чай|кофейный|nitro/.test(hay)) {
    reasons.push("не газированный лимонад/кола (сок/чай/кофе)");
  }
  // keep Abrau light sparkling non-alc if carbonated lemonade-like — don't auto-exclude all
  return reasons;
}

function stable_seq_key(source_sku) {
  // Stable short numeric seq derived from source METRO sku digits.
  const digits = String(source_sku || "").replace(/\D/g, "");
  if (digits) return digits.padStart(3, "0").slice(-3);
  const h = createHash("sha1").update(String(source_sku)).digest("hex");
  return String(parseInt(h.slice(0, 4), 16) % 1000).padStart(3, "0");
}

function build_sku({ brand, volume_ml, package_type, source_sku }) {
  const b = brand_code(brand || "UNKNOWN");
  const v = volume_ml ? String(volume_ml) : "0000";
  const p = package_code(package_type);
  const seq = stable_seq_key(source_sku);
  let sku = `DRINK-${b}-${v}-${p}-${seq}`;
  if (sku.length > 64) {
    sku = `DRINK-${b.slice(0, 10)}-${v}-${p}-${seq}`;
  }
  return sku.replace(/[^A-Z0-9-]/g, "").slice(0, 64);
}

function ensure_unique_skus(rows) {
  const seen = new Map();
  for (const row of rows) {
    let sku = row.sku;
    if (!seen.has(sku)) {
      seen.set(sku, 1);
      continue;
    }
    const n = seen.get(sku) + 1;
    seen.set(sku, n);
    const suffix = `-${String(n).padStart(2, "0")}`;
    const base = sku.slice(0, Math.max(1, 64 - suffix.length));
    row.sku = `${base}${suffix}`;
    row.image_filename = `${row.sku}.webp`;
    row.comments_list.push(`SKU скорректирован для уникальности: ${sku} → ${row.sku}`);
  }
}

function placeholder_image(url) {
  const u = lower(url);
  if (!u) return "пустой URL";
  if (!/^https?:\/\//.test(u)) return "не http(s) URL";
  if (/placeholder|no[_-]?image|default[_-]?image|banner|logo|sprite\.|favicon|1x1|pixel/.test(u)) {
    return "похоже на placeholder/баннер/логотип";
  }
  if (!/cdn\.metro-cc\.ru|metro-cc\.ru/.test(u) && !/\.(png|jpe?g|webp|gif)(\?|$)/.test(u)) {
    return "нестандартный URL изображения";
  }
  return null;
}

async function check_image(url) {
  const pre = placeholder_image(url);
  if (pre) {
    return { image_status: "needs_review", image_review_comment: pre, ok: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TINDA-metro-review/1.0; draft-check-only)",
        Accept: "image/*,*/*;q=0.8",
        Referer: "https://online.metro-cc.ru/",
      },
    });
    clearTimeout(timer);
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok) {
      return {
        image_status: "broken",
        image_review_comment: `HTTP ${res.status}`,
        ok: false,
      };
    }
    if (!ctype.startsWith("image/")) {
      // Some CDNs ignore HEAD content-type — light GET range
      const get = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; TINDA-metro-review/1.0; draft-check-only)",
          Range: "bytes=0-64",
          Referer: "https://online.metro-cc.ru/",
        },
      });
      const gtype = (get.headers.get("content-type") || "").toLowerCase();
      const buf = Buffer.from(await get.arrayBuffer());
      const is_img =
        gtype.startsWith("image/") ||
        buf.slice(0, 8).toString("hex").startsWith("89504e47") || // PNG
        buf.slice(0, 3).toString() === "\xff\xd8\xff" || // JPEG
        buf.slice(0, 4).toString() === "RIFF";
      if (!is_img) {
        return {
          image_status: "needs_review",
          image_review_comment: `не image content-type: ${gtype || ctype || "?"}`,
          ok: false,
        };
      }
    }
    return {
      image_status: "ok",
      image_review_comment: "",
      ok: true,
    };
  } catch (err) {
    return {
      image_status: "broken",
      image_review_comment: `ошибка проверки: ${err.message || err}`,
      ok: false,
    };
  }
}

function load_source_rows() {
  return readFile(SOURCE_XLSX).then((buf) => {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  });
}

function structure_complete(row) {
  const required = [
    "sku",
    "tinda_name",
    "brand",
    "category_slug",
    "volume_text",
    "package_type",
    "units_per_package",
    "sale_unit",
    "min_order_qty",
    "allow_piece_sale",
    "availability",
    "image_url",
    "price_amount",
    "is_active",
  ];
  const missing = [];
  for (const key of required) {
    const v = row[key];
    if (v === null || v === undefined || v === "") missing.push(key);
    if (key === "package_type" && v === "требует проверки") missing.push("package_type(материал)");
    if (key === "category_slug" && v === "drugoe") missing.push("category_slug(уточнить)");
  }
  // booleans / numbers present checks
  if (row.allow_piece_sale === "" || row.allow_piece_sale === undefined) missing.push("allow_piece_sale");
  if (row.is_active === "" || row.is_active === undefined) missing.push("is_active");
  if (!Number.isInteger(Number(row.units_per_package)) || Number(row.units_per_package) < 1) {
    missing.push("units_per_package");
  }
  return missing;
}

function duplicate_key(row) {
  return [
    lower(row.brand),
    lower(row.tinda_name),
    lower(row.volume_text),
    lower(row.package_type),
    lower(row.flavor),
    String(row.units_per_package),
    /без сахара|zero/i.test(row.source_name) ? "sf" : "sug",
  ].join("|");
}

function soft_duplicate_key(row) {
  // Probable dup ignoring package and units — for review block
  return [
    lower(row.brand),
    lower(row.flavor || row.tinda_name),
    lower(row.volume_text),
    /без сахара|zero/i.test(row.source_name) ? "sf" : "sug",
  ].join("|");
}

async function main() {
  console.log("METRO cleanup review — no production writes, no image downloads to disk");
  const source_rows = await load_source_rows();
  console.log(`Source rows: ${source_rows.length}`);

  const processed = [];
  for (const src of source_rows) {
    const source_sku = String(src.sku || "").trim();
    const source_name = norm_space(src.source_name);
    const brand = normalize_brand(src.brand, source_name);
    const pack = detect_package_type(src);
    const vol = normalize_volume_text(src.volume_text, source_name);
    const units_info = extract_units(source_name, src.units_per_package);
    const flavor = extract_flavor(source_name, src.brand || brand);
    const category = assign_category({
      source_name,
      brand,
      flavor,
      metro_category_slug: src.category_slug,
    });
    const exclude_reasons = is_probably_excluded(src);

    const comments = [];
    if (src.comment) comments.push(String(src.comment));
    if (units_info.assumed) {
      comments.push("Количество в транспортной упаковке требует уточнения");
    } else if (units_info.evidence) {
      comments.push(`units из источника: «${units_info.evidence}»`);
    }
    if (pack.reasons?.length) comments.push(`упаковка: ${pack.reasons.join("; ")}`);
    if (category.reasons?.length) comments.push(`категория: ${category.reasons.join("; ")}`);
    comments.push("metro_price справочное; не использовать как price_amount ТИНДА");

    const package_type = pack.package_type;
    const tinda_name = build_tinda_name({
      brand,
      flavor,
      volume_text: vol.volume_text,
      package_type: package_type === "требует проверки" ? "" : package_type,
    });

    const sku = build_sku({
      brand,
      volume_ml: vol.volume_ml,
      package_type: package_type === "требует проверки" ? "другое" : package_type,
      source_sku,
    });

    const row = {
      source_sku,
      source_url: src.source_url,
      source_name,
      brand,
      flavor,
      volume_text: vol.volume_text,
      volume_ml: vol.volume_ml,
      package_type,
      package_confidence: pack.confidence,
      undefined_package_material: Boolean(pack.undefined_material),
      units_per_package: units_info.units,
      units_assumed: units_info.assumed,
      units_evidence: units_info.evidence,
      category_slug: category.category_slug,
      category_ok: category.ok,
      image_url: norm_space(src.image_url),
      metro_price: src.metro_price === "" ? "" : Number(src.metro_price),
      purchase_price_reference: src.metro_price === "" ? "" : Number(src.metro_price),
      sku,
      tinda_name,
      name: tinda_name,
      sale_unit: "упаковка",
      min_order_qty: units_info.units,
      allow_piece_sale: false,
      availability: "in_stock",
      price_amount: "",
      price_currency: "RUB",
      is_promo: false,
      is_new: true,
      is_hit: false,
      description: "",
      is_active: false,
      image_status: "pending",
      image_filename: `${sku}.webp`,
      image_review_comment: "",
      import_status: "needs_review",
      review_bucket: "needs_review",
      exclude_reasons,
      comments_list: comments,
      comment: "",
      structure_missing: [],
      structure_ok_except_price: false,
      probable_duplicate_group: "",
      is_exact_duplicate: false,
      is_soft_duplicate: false,
    };

    processed.push(row);
  }

  ensure_unique_skus(processed);

  // Image checks (HEAD only, no save). Cache results to avoid re-hitting CDN.
  const image_cache_path = path.join(IMPORTS, "metro_image_check_cache.json");
  let image_cache = {};
  try {
    image_cache = JSON.parse(await readFile(image_cache_path, "utf8"));
  } catch {
    image_cache = {};
  }
  const skip_image_net = process.env.METRO_SKIP_IMAGE_CHECK === "1";
  console.log(
    skip_image_net
      ? "Image check: cache/heuristics only (METRO_SKIP_IMAGE_CHECK=1)"
      : "Checking image URLs (HEAD, no download to disk)...",
  );
  let checked = 0;
  let from_cache = 0;
  for (const row of processed) {
    const cached = image_cache[row.image_url];
    if (cached && cached.image_status) {
      row.image_status = cached.image_status;
      row.image_review_comment = cached.image_review_comment || "";
      from_cache += 1;
      continue;
    }
    if (skip_image_net) {
      const pre = placeholder_image(row.image_url);
      if (pre) {
        row.image_status = "needs_review";
        row.image_review_comment = pre;
      } else {
        row.image_status = "ok";
        row.image_review_comment =
          "URL выглядит как CDN-изображение товара; сетевая проверка пропущена";
      }
      image_cache[row.image_url] = {
        image_status: row.image_status,
        image_review_comment: row.image_review_comment,
      };
      continue;
    }
    if (IMAGE_CHECK_LIMIT > 0 && checked >= IMAGE_CHECK_LIMIT) {
      row.image_status = "skipped";
      row.image_review_comment = "проверка ограничена METRO_IMAGE_CHECK_LIMIT";
      continue;
    }
    const result = await check_image(row.image_url);
    row.image_status = result.image_status;
    row.image_review_comment = result.image_review_comment;
    image_cache[row.image_url] = {
      image_status: row.image_status,
      image_review_comment: row.image_review_comment,
    };
    checked += 1;
    if (checked % 25 === 0) console.log(`  images checked: ${checked}/${processed.length}`);
    await sleep(IMAGE_DELAY_MS);
  }
  await writeFile(image_cache_path, JSON.stringify(image_cache, null, 2), "utf8");
  console.log(`Image checks: network=${checked}, cache=${from_cache}`);

  // Duplicates
  const exact_groups = new Map();
  const soft_groups = new Map();
  for (const row of processed) {
    const ek = duplicate_key(row);
    const sk = soft_duplicate_key(row);
    if (!exact_groups.has(ek)) exact_groups.set(ek, []);
    exact_groups.get(ek).push(row);
    if (!soft_groups.has(sk)) soft_groups.set(sk, []);
    soft_groups.get(sk).push(row);
  }
  // Soft duplicates: same brand+flavor+volume+sugar, but different package or units.
  // Exact duplicates: identical business key including package and units.
  for (const [key, group] of exact_groups) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.probable_duplicate_group = key;
      row.comments_list.push(`точный дубль по ключу (${group.length} шт.)`);
      row.is_exact_duplicate = true;
    }
  }
  for (const [key, group] of soft_groups) {
    if (group.length < 2) continue;
    const packs = new Set(group.map((r) => r.package_type));
    const units = new Set(group.map((r) => r.units_per_package));
    const exact_already = group.every((r) => r.is_exact_duplicate);
    if (exact_already) continue;
    if (packs.size > 1 || units.size > 1) {
      for (const row of group) {
        if (row.is_exact_duplicate) continue;
        row.probable_duplicate_group = key;
        row.comments_list.push(
          `вероятные варианты (${group.length}): сходные brand+вкус+объём, разный package/units`,
        );
        row.is_soft_duplicate = true;
      }
    }
  }

  // Status / buckets
  const ready = [];
  const needs_review = [];
  const excluded = [];
  const undefined_package_rows = [];

  for (const row of processed) {
    row.comment = [...new Set(row.comments_list)].join("; ");

    if (row.undefined_package_material) undefined_package_rows.push(row);

    if (row.exclude_reasons.length) {
      row.import_status = "excluded";
      row.review_bucket = "excluded";
      row.comment = `${row.comment}; исключено: ${row.exclude_reasons.join("; ")}`;
      excluded.push(row);
      continue;
    }

    const missing = structure_complete(row);
    // price_amount always empty now → always in missing
    row.structure_missing = missing;
    const missing_except_price = missing.filter((m) => m !== "price_amount");
    row.structure_ok_except_price = missing_except_price.length === 0;

    if (missing.length === 0) {
      row.import_status = "ready";
      row.review_bucket = "ready";
      ready.push(row);
    } else {
      row.import_status = "needs_review";
      row.review_bucket = "needs_review";
      if (!row.category_ok || row.category_slug === "drugoe") {
        row.comments_list.push("категория требует ручного выбора");
      }
      if (row.package_type === "требует проверки") {
        row.comments_list.push("упаковка требует ручного определения");
      }
      row.comment = [...new Set(row.comments_list)].join("; ");
      needs_review.push(row);
    }
  }

  // Sort helpers
  const by_sku = (a, b) => String(a.sku).localeCompare(String(b.sku));
  ready.sort(by_sku);
  needs_review.sort(by_sku);
  excluded.sort(by_sku);
  undefined_package_rows.sort(by_sku);

  const review_columns = [
    "import_status",
    "sku",
    "source_sku",
    "tinda_name",
    "name",
    "source_name",
    "brand",
    "flavor",
    "category_slug",
    "volume_text",
    "package_type",
    "package_confidence",
    "units_per_package",
    "units_assumed",
    "sale_unit",
    "min_order_qty",
    "allow_piece_sale",
    "availability",
    "price_amount",
    "price_currency",
    "purchase_price_reference",
    "metro_price",
    "is_promo",
    "is_new",
    "is_hit",
    "description",
    "image_url",
    "image_status",
    "image_filename",
    "image_review_comment",
    "is_active",
    "structure_ok_except_price",
    "structure_missing",
    "probable_duplicate_group",
    "source_url",
    "comment",
  ];

  function to_sheet_rows(rows) {
    return rows.map((r) => {
      const out = {};
      for (const col of review_columns) {
        let v = r[col];
        if (col === "structure_missing" && Array.isArray(v)) v = v.join(", ");
        out[col] = v ?? "";
      }
      return out;
    });
  }

  // Probable duplicates block (subset of needs_review)
  const probable_dups = needs_review.filter((r) => r.probable_duplicate_group);

  // Dictionaries sheet
  const dict_brands = [...new Set(processed.map((r) => r.brand).filter(Boolean))].sort();
  const dict_packages = ALLOWED_PACKAGE_TYPES.map((v) => ({ value: v }));
  const dict_categories = ALLOWED_CATEGORIES.map((v) => ({
    category_slug: v,
    note:
      v === "drugoe"
        ? "только временная для проверки"
        : v === "energetiki"
          ? "использовать только если позиция реально энергетик"
          : "",
  }));
  const dict_sale_units = ["упаковка", "шт", "коробка", "блок", "кг"].map((v) => ({
    sale_unit: v,
  }));
  const dict_availability = ["in_stock", "on_order", "out_of_stock"].map((v) => ({
    availability: v,
  }));

  const instruction_rows = [
    { step: 1, text: "Исходный файл metro_gazirovannye_napitki.xlsx не изменялся." },
    { step: 2, text: "Лист «Готово к импорту»: только import_status=ready (нужен заполненный price_amount)." },
    { step: 3, text: "Лист «Требует проверки»: нужно заполнить price_amount и/или уточнить упаковку/категорию/дубли." },
    { step: 4, text: "Лист «Исключено»: позиции вне целевого ассортимента." },
    { step: 5, text: "metro_price / purchase_price_reference — только справочно, не цена ТИНДА." },
    { step: 6, text: "Не копируйте metro_price в price_amount." },
    { step: 7, text: "Фото не скачивались. image_filename — целевое имя после будущей загрузки (SKU.webp)." },
    { step: 8, text: "is_active=false до ручной проверки цены и упаковки." },
    { step: 9, text: "SKU стабилен относительно source_sku (METRO-XXXX)." },
    { step: 10, text: "Тестовая партия: metro_test_batch_50.xlsx — до 50 позиций без цены." },
    { step: 11, text: "Production import / DB / VPS image download — запрещены на этом этапе." },
  ];

  await mkdir(IMPORTS, { recursive: true });

  // Main review workbook
  const review_wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(to_sheet_rows(ready), { header: review_columns }),
    "Готово к импорту",
  );
  // Needs review: put probable dups first visually via sort flag column already present
  const needs_sorted = [
    ...probable_dups.sort(by_sku),
    ...needs_review.filter((r) => !r.probable_duplicate_group).sort(by_sku),
  ];
  // de-dup if probable also in needs
  const seen_needs = new Set();
  const needs_unique = [];
  for (const r of needs_sorted) {
    if (seen_needs.has(r.sku)) continue;
    seen_needs.add(r.sku);
    needs_unique.push(r);
  }
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(to_sheet_rows(needs_unique), { header: review_columns }),
    "Требует проверки",
  );
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(to_sheet_rows(excluded), { header: review_columns }),
    "Исключено",
  );

  // Dictionaries — multiple tables stacked with labels
  const dict_sheet = XLSX.utils.aoa_to_sheet([
    ["Справочник: допустимые package_type"],
    ["value"],
    ...ALLOWED_PACKAGE_TYPES.map((v) => [v]),
    [],
    ["Справочник: category_slug"],
    ["category_slug", "note"],
    ...dict_categories.map((r) => [r.category_slug, r.note]),
    [],
    ["Справочник: sale_unit"],
    ["sale_unit"],
    ...dict_sale_units.map((r) => [r.sale_unit]),
    [],
    ["Справочник: availability"],
    ["availability"],
    ...dict_availability.map((r) => [r.availability]),
    [],
    ["Бренды в выборке"],
    ["brand"],
    ...dict_brands.map((b) => [b]),
    [],
    ["Статусы import_status"],
    ["value", "meaning"],
    ["ready", "все обязательные поля заполнены, включая price_amount"],
    ["needs_review", "нужна ручная доработка (часто пустой price_amount)"],
    ["excluded", "исключено из импорта"],
  ]);
  XLSX.utils.book_append_sheet(review_wb, dict_sheet, "Справочники");
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(instruction_rows),
    "Инструкция",
  );

  // Extra sheet with undefined package list (also separate file)
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(
      undefined_package_rows.map((r) => ({
        source_sku: r.source_sku,
        sku: r.sku,
        brand: r.brand,
        source_name: r.source_name,
        tinda_name: r.tinda_name,
        volume_text: r.volume_text,
        package_type: r.package_type,
        source_url: r.source_url,
        image_url: r.image_url,
        comment: "материал упаковки не определён однозначно",
      })),
    ),
    "Упаковка не ясна",
  );

  // Probable duplicates block sheet for convenience
  XLSX.utils.book_append_sheet(
    review_wb,
    XLSX.utils.json_to_sheet(to_sheet_rows(probable_dups), { header: review_columns }),
    "Вероятные дубли",
  );

  const review_path = path.join(IMPORTS, "metro_gazirovannye_napitki_review.xlsx");
  XLSX.writeFile(review_wb, review_path);

  // Separate undefined package workbook
  const undef_wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    undef_wb,
    XLSX.utils.json_to_sheet(
      undefined_package_rows.map((r) => ({
        source_sku: r.source_sku,
        sku: r.sku,
        brand: r.brand,
        source_name: r.source_name,
        tinda_name: r.tinda_name,
        volume_text: r.volume_text,
        units_per_package: r.units_per_package,
        source_url: r.source_url,
        image_url: r.image_url,
        draft_package_type_source: "шт/упаковка без материала",
      })),
    ),
    "Неопределённая упаковка",
  );
  const undef_path = path.join(IMPORTS, "metro_undefined_package_material.xlsx");
  XLSX.writeFile(undef_wb, undef_path);

  // Test batch 50 — known brands, clear package, volume, image; one per soft key.
  const preferred_brands = [
    "Coca-Cola",
    "Добрый",
    "Evervess",
    "Черноголовка",
    "Rich",
    "Натахтари",
    "Fanta",
    "Sprite",
    "Schweppes",
    "Cool Cola",
    "Aziano",
    "Frustyle",
    "Laimon Fresh",
    "Chillout",
    "Fresh Bar",
    "Street",
  ];
  const preferred_set = new Set(preferred_brands);

  const batch_pool = needs_review
    .filter((r) => r.brand && r.volume_text)
    .filter((r) => ["ПЭТ", "стекло", "жестяная банка"].includes(r.package_type))
    .filter((r) => r.image_status === "ok")
    .filter((r) => r.category_slug !== "drugoe")
    .filter((r) => !r.is_exact_duplicate)
    .sort((a, b) => {
      const ap = preferred_set.has(a.brand) ? 0 : 1;
      const bp = preferred_set.has(b.brand) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ac = a.structure_ok_except_price ? 0 : 1;
      const bc = b.structure_ok_except_price ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.sku.localeCompare(b.sku);
    });

  const batch = [];
  const per_cat = new Map();
  const used_soft = new Set();
  for (const row of batch_pool) {
    if (batch.length >= 50) break;
    const soft = soft_duplicate_key(row);
    if (used_soft.has(soft)) continue;
    const count = per_cat.get(row.category_slug) || 0;
    if (count >= 18) continue;
    per_cat.set(row.category_slug, count + 1);
    used_soft.add(soft);
    batch.push(row);
  }

  const batch_columns = [
    "sku",
    "source_sku",
    "name",
    "brand",
    "flavor",
    "category_slug",
    "volume_text",
    "package_type",
    "units_per_package",
    "sale_unit",
    "min_order_qty",
    "allow_piece_sale",
    "availability",
    "price_amount",
    "price_currency",
    "purchase_price_reference",
    "is_promo",
    "is_new",
    "is_hit",
    "description",
    "image_url",
    "image_filename",
    "image_status",
    "is_active",
    "import_status",
    "source_url",
    "source_name",
    "comment",
  ];

  const batch_wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    batch_wb,
    XLSX.utils.json_to_sheet(
      batch.map((r) => {
        const out = {};
        for (const c of batch_columns) out[c] = r[c] ?? "";
        return out;
      }),
      { header: batch_columns },
    ),
    "Тестовая партия",
  );
  XLSX.utils.book_append_sheet(
    batch_wb,
    XLSX.utils.json_to_sheet([
      { field: "price_amount", action: "Заполнить вручную оптовую цену ТИНДА (RUB). Не копировать metro_price." },
      { field: "is_active", action: "Включить true только после проверки цены и упаковки." },
      { field: "package_type", action: "Если сомнение — сверить с фото/карточкой METRO." },
      { field: "units_per_package / min_order_qty", action: "Уточнить транспортную упаковку, если units_assumed." },
      { field: "category_slug", action: "Проверить соответствие: kola / limonady / toniki / gazirovannye-napitki." },
      { field: "description", action: "Опционально добавить краткое описание." },
      { field: "image", action: "Позже скачать по image_url и сохранить как image_filename (не на этом этапе)." },
      { field: "sale_unit", action: "По умолчанию «упаковка»; изменить при необходимости." },
    ]),
    "Что заполнить вручную",
  );
  const batch_path = path.join(IMPORTS, "metro_test_batch_50.xlsx");
  XLSX.writeFile(batch_wb, batch_path);

  // Stats for report
  const structure_ok = processed.filter((r) => r.structure_ok_except_price && r.import_status !== "excluded").length;
  const units_unknown = processed.filter((r) => r.units_assumed && r.import_status !== "excluded").length;
  const image_problems = processed.filter((r) => r.image_status !== "ok" && r.import_status !== "excluded");
  const image_broken = processed.filter((r) => r.image_status === "broken").length;
  const image_review = processed.filter((r) => r.image_status === "needs_review").length;
  const probable_dup_count = new Set(
    processed.filter((r) => r.probable_duplicate_group).map((r) => r.probable_duplicate_group),
  ).size;
  const probable_dup_rows = processed.filter((r) => r.probable_duplicate_group).length;

  const report = `# Отчёт очистки METRO → ТИНДА (черновик)

Дата: ${new Date().toISOString()}

Исходный файл: \`data/imports/metro_gazirovannye_napitki.xlsx\` (не изменялся)

## Итоги

| Показатель | Количество |
|---|---|
| Всего строк | ${processed.length} |
| Готово к импорту (\`ready\`, лист «Готово к импорту») | ${ready.length} |
| Готово **по структуре** (все поля кроме \`price_amount\`) | ${structure_ok} |
| Требует проверки | ${needs_review.length} |
| Исключено | ${excluded.length} |
| Неопределённая упаковка (материал) | ${undefined_package_rows.length} |
| Неизвестное количество в упаковке (принято 1 + комментарий) | ${units_unknown} |
| Групп вероятных дублей | ${probable_dup_count} |
| Строк в вероятных дублях | ${probable_dup_rows} |
| Проблемы с изображениями (не ok) | ${image_problems.length} (broken: ${image_broken}, needs_review: ${image_review}) |
| Строк в тестовой партии | ${batch.length} |

> Пока \`price_amount\` пустой, \`import_status=ready\` невозможен — это ожидаемо.

## Файлы

- \`data/imports/metro_gazirovannye_napitki_review.xlsx\` — рабочий review-файл
- \`data/imports/metro_undefined_package_material.xlsx\` — список позиций с неопределённым материалом упаковки
- \`data/imports/metro_test_batch_50.xlsx\` — тестовая партия (до 50)
- \`data/imports/metro_cleanup_report.md\` — этот отчёт

## Листы review-файла

1. **Готово к импорту** — только \`ready\` (сейчас пусто без цен)
2. **Требует проверки** — основная очередь ручной доработки
3. **Исключено** — вне ассортимента
4. **Справочники** — допустимые значения
5. **Инструкция** — правила работы
6. **Упаковка не ясна** — ${undefined_package_rows.length} позиций
7. **Вероятные дубли** — блок для сверки

## Что заполнить вручную

1. **price_amount** — оптовая цена ТИНДА (RUB). Не копировать \`metro_price\` / \`purchase_price_reference\`.
2. **package_type** — для ${undefined_package_rows.length} позиций с «требует проверки» (см. отдельный Excel).
3. **units_per_package** / **min_order_qty** — где стоит пометка об уточнении транспортной упаковки (${units_unknown} шт.).
4. **category_slug** — если стоит \`drugoe\` или сомнение между kola/limonady/toniki/gazirovannye-napitki.
5. **Вероятные дубли** — решить, что оставить / что исключить.
6. **is_active** — оставлять \`false\`, пока цена и упаковка не проверены.
7. **description** — по желанию.
8. **Фото** — позже скачать по \`image_url\` в файл \`image_filename\` (SKU.webp); сейчас только проверка URL.

## Ограничения этого этапа

- В production ничего не загружалось
- База данных не менялась
- Изображения на VPS не скачивались (только HTTP HEAD/короткий probe)
- \`metro_price\` не использовался как цена ТИНДА
`;

  const report_path = path.join(IMPORTS, "metro_cleanup_report.md");
  await writeFile(report_path, report, "utf8");

  // Also dump json snapshot for debugging
  await writeFile(
    path.join(IMPORTS, "metro_cleanup_stats.json"),
    JSON.stringify(
      {
        total: processed.length,
        ready: ready.length,
        structure_ok_except_price: structure_ok,
        needs_review: needs_review.length,
        excluded: excluded.length,
        undefined_package_material: undefined_package_rows.length,
        units_unknown,
        probable_duplicate_groups: probable_dup_count,
        probable_duplicate_rows: probable_dup_rows,
        image_problems: image_problems.length,
        image_broken,
        image_review,
        test_batch: batch.length,
        test_batch_categories: Object.fromEntries(per_cat),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\n=== CLEANUP RESULT ===");
  console.log(`review: ${review_path}`);
  console.log(`undefined packages: ${undef_path} (${undefined_package_rows.length})`);
  console.log(`test batch: ${batch_path} (${batch.length})`);
  console.log(`report: ${report_path}`);
  console.log(`ready: ${ready.length}`);
  console.log(`structure_ok_except_price: ${structure_ok}`);
  console.log(`needs_review: ${needs_review.length}`);
  console.log(`excluded: ${excluded.length}`);
  console.log(`image problems: ${image_problems.length}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
