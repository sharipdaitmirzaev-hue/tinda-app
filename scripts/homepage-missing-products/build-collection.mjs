#!/usr/bin/env node
/**
 * LOCAL ONLY: build homepage missing-products collection artifacts.
 * Does NOT touch production / VPS / DB / homepage / prices / seed.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data/imports/homepage-missing-products");
const ORIGINAL = path.join(OUT, "original");
const PREVIEWS = path.join(OUT, "previews");
const META = path.join(OUT, "tmp-meta");

mkdirSync(ORIGINAL, { recursive: true });
mkdirSync(PREVIEWS, { recursive: true });
mkdirSync(META, { recursive: true });

const catalogCheck = JSON.parse(
  readFileSync(path.join(META, "tinda-catalog-check.json"), "utf8"),
);

const tindaRelated = catalogCheck.related || [];
const proposedSkusUsed = new Set(
  (catalogCheck.bySku || []).map((r) => r.sku),
);

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function detectMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/** @type {Array<any>} */
const candidates = [
  {
    id: "coca-cola-zero-330-glass-napitkiopt",
    target_group: "coca_cola_zero_033_glass",
    role: "primary",
    source_site: "napitkiopt.ru",
    source_product_url:
      "https://napitkiopt.ru/coca-cola-koka-kola-zero-zero-0-33-l-steklo-up-15-sht-gruziya/",
    source_name: "Coca‑Cola Zero 0,33 л стекло (Грузия)",
    brand: "Coca-Cola",
    flavor: "Original / Zero Sugar",
    sugar_free: true,
    volume_text: "0,33 л",
    volume_ml: 330,
    package_type: "стекло",
    package_norm: "glass",
    unit_type: "single",
    multipack_sale_note: "Продаётся уп. 15 шт.; единица — одна стеклянная бутылка 0,33 л",
    candidate_image_url:
      "https://napitkiopt.ru/wa-data/public/shop/products/12/20/2012/images/1295/1295.970.jpg",
    local_original_name: "coca-cola-zero-330-glass-napitkiopt.jpg",
    source_price_reference: "2280 ₽ / уп. 15 шт. (справочно, не цена ТИНДА)",
    availability_reference: "в наличии на napitkiopt.ru (карточка товара)",
    proposed_sku: "ZY-COCACOLAZERO-330-GLASS-001",
    notes: "Чистое студийное фото одной стеклянной бутылки Zero без watermark.",
  },
  {
    id: "coca-cola-zero-330-glass-dblack",
    target_group: "coca_cola_zero_033_glass",
    role: "alternate",
    source_site: "dblack.ru",
    source_product_url:
      "https://dblack.ru/catalog/bezalkogolnye_napitki/koka-kola-zero-dieticheskaja-steklo-0-33-l/",
    source_name: "Coca-Cola Zero диетическая стекло 0,33 л",
    brand: "Coca-Cola",
    flavor: "Original / Zero Sugar",
    sugar_free: true,
    volume_text: "0,33 л",
    volume_ml: 330,
    package_type: "стекло",
    package_norm: "glass",
    unit_type: "single",
    multipack_sale_note: "На фото бейджи «ДИЕТИЧЕСКАЯ» и «УПАКОВКА 15×330 мл»",
    candidate_image_url:
      "https://dblack.ru/wp-content/uploads/2022/06/05_07_18_coca-cola_330_01_zero.jpg",
    local_original_name: "coca-cola-zero-330-glass-dblack.jpg",
    source_price_reference: "2340 ₽ / уп. (справочно, не цена ТИНДА)",
    availability_reference: "карточка dblack.ru",
    proposed_sku: "ZY-COCACOLAZERO-330-GLASS-001",
    notes: "Бутылка корректная, но на изображении промо-бейджи/баннеры — не auto-approve.",
  },
  {
    id: "sprite-2000-pet-napolke",
    target_group: "sprite_2l_pet",
    role: "primary",
    source_site: "napolke.ru",
    source_product_url:
      "https://napolke.ru/catalog/soki_vody_napitki/gazirovannye_napitki_limonady/product/napitok_gazirovanny_j_sprite_belarus_2_l_pe_t-80663334-0b30-4dcb-aab0-ec1126216c43",
    source_name: "Напиток газированный Sprite Беларусь 2 л., ПЭТ",
    brand: "Sprite",
    flavor: "Лимон-лайм (обычная версия)",
    sugar_free: false,
    volume_text: "2 л",
    volume_ml: 2000,
    package_type: "ПЭТ",
    package_norm: "pet",
    unit_type: "single",
    multipack_sale_note: "Опт указывает 6 шт в упаковке; на фото — одна бутылка",
    candidate_image_url:
      "https://img.napolke.ru/image/get?uuid=37ce4ee4-6e6f-4569-97c0-0d0c7ade4bef&size=800x800",
    local_original_name: "sprite-2000-pet-napolke.jpg",
    source_price_reference: "166.60 ₽/шт (справочно, не цена ТИНДА)",
    availability_reference: "карточка napolke.ru",
    proposed_sku: "ZY-SPRITE-2000-PET-001",
    notes: "Одна ПЭТ-бутылка обычного Sprite, без watermark, 740×740.",
  },
  {
    id: "sprite-2000-pet-napitkiopt",
    target_group: "sprite_2l_pet",
    role: "alternate_reject",
    source_site: "napitkiopt.ru",
    source_product_url: "https://napitkiopt.ru/sprayt-2-l-up-6-sht-rf/",
    source_name: "Sprite (Спрайт) 2 л. (уп. 6 шт.) КЗ",
    brand: "Sprite",
    flavor: "Лимон-лайм (обычная версия)",
    sugar_free: false,
    volume_text: "2 л",
    volume_ml: 2000,
    package_type: "ПЭТ",
    package_norm: "pet",
    unit_type: "single",
    multipack_sale_note: "Продаётся уп. 6 шт.",
    candidate_image_url:
      "https://napitkiopt.ru/wa-data/public/shop/products/27/13/1327/images/556/556.750x0.jpg",
    local_original_name: "sprite-2000-pet-napitkiopt.jpg",
    source_price_reference: "1490 ₽ / уп. 6 шт. (справочно)",
    availability_reference: "карточка napitkiopt.ru",
    proposed_sku: "ZY-SPRITE-2000-PET-001",
    notes: "Есть watermark ozon.ru; ширина <500 — reject.",
  },
  {
    id: "adrenaline-250-can-ofisshop",
    target_group: "adrenaline_rush",
    adrenaline_size_role: "small",
    role: "primary",
    source_site: "ofisshop.ru",
    source_product_url:
      "https://ofisshop.ru/catalog/energetiki/napitok_energeticheskiy_adrenaline_rush_025l_zhb_1559495/",
    source_name: "Напиток энергетический Adrenaline Rush 0.25л, ж/б",
    brand: "Adrenaline Rush",
    flavor: "Абсолютная энергия / classic",
    sugar_free: false,
    volume_text: "0,25 л",
    volume_ml: 250,
    package_type: "жестяная банка",
    package_norm: "can",
    unit_type: "single",
    multipack_sale_note: null,
    candidate_image_url:
      "https://ofisshop.ru/upload/iblock/057/i8aroik8hysqwmk35xxuif5kqqlt9wsv.webp",
    local_original_name: "adrenaline-250-can-ofisshop.webp",
    source_price_reference: "118 ₽/шт (справочно, не цена ТИНДА)",
    availability_reference: "карточка ofisshop.ru",
    proposed_sku: "ZY-ADRENALINE-250-CAN-001",
    notes: "Минимальный стандартный объём (маленький). Единичная банка.",
  },
  {
    id: "adrenaline-250-can-barista",
    target_group: "adrenaline_rush",
    adrenaline_size_role: "small_alternate",
    role: "alternate",
    source_site: "barista-ltd.ru",
    source_product_url:
      "https://www.barista-ltd.ru/magazin/adrenaline-rush-klassik-250ml.html",
    source_name: "Adrenaline Rush Абсолютная энергия 250 мл ж/б",
    brand: "Adrenaline Rush",
    flavor: "Абсолютная энергия / classic",
    sugar_free: false,
    volume_text: "0,25 л",
    volume_ml: 250,
    package_type: "жестяная банка",
    package_norm: "can",
    unit_type: "single",
    multipack_sale_note: "В упаковке 12 шт у поставщика; фото — одна банка",
    candidate_image_url:
      "https://www.barista-ltd.ru/components/com_jshopping/files/img_products/adrenalin-rash-025l.jpg",
    local_original_name: "adrenaline-250-can-barista.jpg",
    source_price_reference: "78 ₽/шт (справочно)",
    availability_reference: "карточка barista-ltd.ru",
    proposed_sku: "ZY-ADRENALINE-250-CAN-001",
    notes: "Альтернативное фото 250 мл, 508×508.",
  },
  {
    id: "adrenaline-330-can-ofisshop",
    target_group: "adrenaline_rush",
    adrenaline_size_role: "mid_preview_only",
    role: "volume_variant",
    source_site: "ofisshop.ru",
    source_product_url:
      "https://ofisshop.ru/catalog/energetiki/energeticheskiy_napitok_adrenaline_rush_330ml_1965282/",
    source_name: "Энергетический напиток Adrenaline Rush 330мл",
    brand: "Adrenaline Rush",
    flavor: "Абсолютная энергия / classic",
    sugar_free: false,
    volume_text: "0,33 л",
    volume_ml: 330,
    package_type: "жестяная банка",
    package_norm: "can",
    unit_type: "single",
    multipack_sale_note: null,
    candidate_image_url:
      "https://ofisshop.ru/upload/iblock/87d/czq7dt9vn7r8alpeab2firuwf4wg2cdz.webp",
    local_original_name: "adrenaline-330-can-ofisshop.webp",
    source_price_reference: "135 ₽/шт (справочно)",
    availability_reference: "карточка ofisshop.ru",
    proposed_sku: "ZY-ADRENALINE-330-CAN-001",
    notes: "Промежуточный стандартный объём — только preview всех вариантов, не auto small/large.",
  },
  {
    id: "adrenaline-449-can-ofisshop",
    target_group: "adrenaline_rush",
    adrenaline_size_role: "large",
    role: "primary",
    source_site: "ofisshop.ru",
    source_product_url:
      "https://ofisshop.ru/catalog/energetiki/napitok_energeticheskiy_adrenaline_rush_449ml_1965286/",
    source_name: "Энергетический напиток Adrenaline Rush 449мл",
    brand: "Adrenaline Rush",
    flavor: "Абсолютная энергия / classic",
    sugar_free: false,
    volume_text: "0,449 л",
    volume_ml: 449,
    package_type: "жестяная банка",
    package_norm: "can",
    unit_type: "single",
    multipack_sale_note: null,
    candidate_image_url:
      "https://ofisshop.ru/upload/iblock/3f7/xl80zdj1crhxg36q9pi2t0pzv3jgbjwy.webp",
    local_original_name: "adrenaline-449-can-ofisshop.webp",
    source_price_reference: "169 ₽/шт (справочно, не цена ТИНДА)",
    availability_reference: "карточка ofisshop.ru",
    proposed_sku: "ZY-ADRENALINE-449-CAN-001",
    notes: "Максимальный стандартный объём (большой). Единичная банка.",
  },
  {
    id: "adrenaline-449-can-magnit",
    target_group: "adrenaline_rush",
    adrenaline_size_role: "large_alternate",
    role: "alternate",
    source_site: "magnit.ru",
    source_product_url:
      "https://magnit.ru/product/1000275580-napitok_energeticheskiy_adrenaline_rush_449ml",
    source_name: "Энергетический напиток Adrenaline Rush 449мл",
    brand: "Adrenaline Rush",
    flavor: "Абсолютная энергия / classic",
    sugar_free: false,
    volume_text: "0,449 л",
    volume_ml: 449,
    package_type: "жестяная банка",
    package_norm: "can",
    unit_type: "single",
    multipack_sale_note: null,
    candidate_image_url:
      "https://images-foodtech.magnit.ru/jL2loMOA_6MIq1GnOAB9xTJwDDt_t9-oR0nEXeKd5Nw/rs:fit:1600:1600/plain/s3://img-dostavka/catalog/pim/goods/1000275580/image/24e7441d9d8fd8798a117e16f7de0979.jpeg@webp",
    local_original_name: "adrenaline-449-can-magnit.webp",
    source_price_reference: "139.99 ₽ (справочно, не цена ТИНДА)",
    availability_reference: "карточка magnit.ru",
    proposed_sku: "ZY-ADRENALINE-449-CAN-001",
    notes: "Альтернатива 1600×1600; объём 0,449 виден на банке.",
  },
];

function findRelated(c) {
  const hits = [];
  for (const p of tindaRelated) {
    const name = `${p.name} ${p.brand || ""}`.toLowerCase();
    if (c.target_group === "coca_cola_zero_033_glass") {
      if (name.includes("zero") && (name.includes("coca") || name.includes("кока"))) {
        hits.push(p);
      }
    } else if (c.target_group === "sprite_2l_pet") {
      if (name.includes("sprite") || name.includes("спрайт")) hits.push(p);
    } else if (c.target_group === "adrenaline_rush") {
      if (name.includes("adrenaline") || name.includes("адреналин")) hits.push(p);
    }
  }
  return hits;
}

function classifyMatch(c, related) {
  if (!related.length) return { match_status: "new_product", reason: "no_related_in_tinda" };

  if (c.target_group === "coca_cola_zero_033_glass") {
    const sameVolCan = related.filter(
      (p) =>
        String(p.volume_text || "").includes("0,33") &&
        String(p.package_type || "").toLowerCase().includes("банк"),
    );
    if (sameVolCan.length) {
      return {
        match_status: "new_product",
        reason:
          "exists_zero_can_same_volume_different_package_glass_missing_not_duplicate",
        related: sameVolCan,
      };
    }
  }

  if (c.target_group === "sprite_2l_pet") {
    const other = related.filter(
      (p) => !(String(p.volume_text || "").includes("2") && String(p.package_type || "").toLowerCase().includes("пэт")),
    );
    if (other.length) {
      return {
        match_status: "new_product",
        reason: "sprite_exists_other_volume_package_2l_pet_missing",
        related: other,
      };
    }
  }

  // Same brand+volume+package under different spelling would be exact/probable
  return { match_status: "new_product", reason: "related_but_not_same_sku", related };
}

function autoReview(c, meta, match) {
  const reasons = [];
  let decision = "approved_new";

  if (c.role === "alternate_reject") {
    decision = "rejected";
    reasons.push("role_alternate_reject");
  }
  if (c.id.includes("vodoley") || c.local_original_name.includes("vodoley")) {
    decision = "rejected";
    reasons.push("watermark_or_wrong_volume");
  }
  if (c.id.includes("dblack")) {
    decision = "needs_review";
    reasons.push("promo_badges_on_image");
  }
  if (c.notes && /(?:^|[^\wа-я])watermark(?:[^\wа-я]|$)/i.test(c.notes) && !/без\s+watermark|no\s+watermark|без\s+водяных/i.test(c.notes)) {
    decision = "rejected";
    reasons.push("watermark");
  }
  if (c.id === "sprite-2000-pet-napitkiopt" || /есть watermark|ozon\.ru watermark/i.test(c.notes || "")) {
    decision = "rejected";
    reasons.push("watermark");
  }

  if (!meta || meta.width == null || meta.height == null) {
    decision = "rejected";
    reasons.push("missing_image_meta");
  } else if (meta.width < 500 || meta.height < 500) {
    decision = "rejected";
    reasons.push(`image_below_500x500_${meta.width}x${meta.height}`);
  }

  if (c.package_norm !== "glass" && c.target_group === "coca_cola_zero_033_glass") {
    decision = "rejected";
    reasons.push("package_not_glass");
  }
  if (c.target_group === "coca_cola_zero_033_glass" && c.sugar_free !== true) {
    decision = "rejected";
    reasons.push("not_sugar_free");
  }
  if (c.target_group === "sprite_2l_pet") {
    if (c.volume_ml !== 2000 || c.package_norm !== "pet") {
      decision = "rejected";
      reasons.push("not_sprite_2l_pet");
    }
    if (c.sugar_free === true) {
      decision = "rejected";
      reasons.push("sprite_zero_not_regular");
    }
  }
  if (c.target_group === "adrenaline_rush") {
    if (c.package_norm !== "can" || c.unit_type !== "single") {
      decision = "rejected";
      reasons.push("not_single_can");
    }
    if (c.adrenaline_size_role === "mid_preview_only") {
      decision = "needs_review";
      reasons.push("mid_volume_preview_only_not_auto_small_or_large");
    }
  }

  if (match.match_status === "exact_match") {
    decision = "rejected";
    reasons.push("exact_duplicate_in_tinda");
  }
  if (match.match_status === "conflict") {
    decision = "needs_review";
    reasons.push("conflict");
  }
  if (proposedSkusUsed.has(c.proposed_sku)) {
    decision = "rejected";
    reasons.push("proposed_sku_already_exists");
  }

  // Only primary+qualifying get approved_new
  if (decision === "approved_new" && c.role !== "primary") {
    decision = "needs_review";
    reasons.push("alternate_not_auto_primary");
  }

  // Brand/volume/package checks already encoded above
  if (decision === "approved_new") {
    reasons.push("auto_approve_rules_passed");
  }

  return { decision, reasons };
}

const manifest = [];
const enriched = [];

for (const c of candidates) {
  const localPath = path.join(ORIGINAL, c.local_original_name);
  if (!existsSync(localPath)) {
    throw new Error(`Missing local original: ${localPath}`);
  }
  const buf = readFileSync(localPath);
  const meta = await sharp(buf).metadata();
  const mime = detectMime(buf);
  const hash = sha256(buf);
  const previewName = c.local_original_name.replace(/\.(webp|png)$/i, ".jpg");
  const previewPath = path.join(PREVIEWS, previewName);
  await sharp(buf)
    .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(previewPath);

  const related = findRelated(c);
  const match = classifyMatch(c, related);
  const review = autoReview(
    c,
    { width: meta.width, height: meta.height },
    match,
  );

  const row = {
    ...c,
    image_width: meta.width,
    image_height: meta.height,
    mime_type: mime,
    file_size: buf.length,
    sha256: hash,
    local_original_path: path.relative(ROOT, localPath),
    local_preview_path: path.relative(ROOT, previewPath),
    match_status: match.match_status,
    match_reason: match.reason,
    tinda_related: related,
    review_decision: review.decision,
    review_reasons: review.reasons,
    sku_unique: !proposedSkusUsed.has(c.proposed_sku),
  };
  enriched.push(row);

  manifest.push({
    id: c.id,
    target_group: c.target_group,
    role: c.role,
    adrenaline_size_role: c.adrenaline_size_role || null,
    source_site: c.source_site,
    source_product_url: c.source_product_url,
    source_name: c.source_name,
    brand: c.brand,
    flavor: c.flavor,
    sugar_free: c.sugar_free,
    volume_text: c.volume_text,
    volume_ml: c.volume_ml,
    package_type: c.package_type,
    candidate_image_url: c.candidate_image_url,
    image_width: meta.width,
    image_height: meta.height,
    mime_type: mime,
    file_size: buf.length,
    sha256: hash,
    local_original_path: path.relative(ROOT, localPath),
    local_preview_path: path.relative(ROOT, previewPath),
    source_price_reference: c.source_price_reference,
    availability_reference: c.availability_reference,
    proposed_sku: c.proposed_sku,
    sku_unique: !proposedSkusUsed.has(c.proposed_sku),
    match_status: match.match_status,
    match_reason: match.reason,
    tinda_related_skus: related.map((r) => r.sku),
    review_decision: review.decision,
    review_reasons: review.reasons,
  });
}

// Adrenaline volume selection
const adrVolumes = [...new Set(
  enriched
    .filter((c) => c.target_group === "adrenaline_rush")
    .map((c) => c.volume_ml),
)].sort((a, b) => a - b);

const adrenalineSelection = {
  available_standard_volumes_ml: adrVolumes,
  available_standard_volumes_text: adrVolumes.map((v) =>
    v === 250 ? "0,25 л" : v === 330 ? "0,33 л" : v === 449 ? "0,449 л" : `${v} мл`,
  ),
  small: {
    volume_ml: Math.min(...adrVolumes),
    volume_text: "0,25 л",
    proposed_sku: "ZY-ADRENALINE-250-CAN-001",
    primary_candidate_id: "adrenaline-250-can-ofisshop",
    rule: "min_standard_single_can",
  },
  large: {
    volume_ml: Math.max(...adrVolumes),
    volume_text: "0,449 л",
    proposed_sku: "ZY-ADRENALINE-449-CAN-001",
    primary_candidate_id: "adrenaline-449-can-ofisshop",
    rule: "max_standard_single_can",
  },
  mid_preview_only: {
    volume_ml: 330,
    volume_text: "0,33 л",
    proposed_sku: "ZY-ADRENALINE-330-CAN-001",
    note: "Показан в preview всех вариантов; не выбран как маленький/большой",
  },
  excluded: [
    "миниатюры",
    "промонаборы",
    "мультипаки / упаковки из нескольких банок",
  ],
};

const approved = enriched.filter((c) => c.review_decision === "approved_new");
const importReady = approved.filter((c) => c.role === "primary");

const candidatesOut = {
  generated_at: new Date().toISOString(),
  note: "LOCAL PREVIEW ONLY. Production / VPS / DB / homepage / prices / seed not changed. No products created.",
  tinda_catalog_check: {
    product_count: catalogCheck.product_count,
    proposed_skus_existing: catalogCheck.bySku,
    related_products: tindaRelated,
  },
  adrenaline_selection: adrenalineSelection,
  candidates: enriched.map((c) => ({
    id: c.id,
    target_group: c.target_group,
    role: c.role,
    adrenaline_size_role: c.adrenaline_size_role || null,
    source_site: c.source_site,
    source_product_url: c.source_product_url,
    source_name: c.source_name,
    brand: c.brand,
    flavor: c.flavor,
    sugar_free: c.sugar_free,
    volume_text: c.volume_text,
    volume_ml: c.volume_ml,
    package_type: c.package_type,
    package_norm: c.package_norm,
    unit_type: c.unit_type,
    multipack_sale_note: c.multipack_sale_note,
    candidate_image_url: c.candidate_image_url,
    image_width: c.image_width,
    image_height: c.image_height,
    mime_type: c.mime_type,
    source_price_reference: c.source_price_reference,
    availability_reference: c.availability_reference,
    local_original_path: c.local_original_path,
    local_preview_path: c.local_preview_path,
    proposed_sku: c.proposed_sku,
    sku_unique: c.sku_unique,
    match_status: c.match_status,
    match_reason: c.match_reason,
    tinda_related: c.tinda_related,
    review_decision: c.review_decision,
    review_reasons: c.review_reasons,
    notes: c.notes,
  })),
};

writeFileSync(path.join(OUT, "candidates.json"), JSON.stringify(candidatesOut, null, 2));
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  generated_at: new Date().toISOString(),
  note: "LOCAL ONLY — images archived under original/ and previews/",
  count: manifest.length,
  items: manifest,
}, null, 2));

// gallery.html
const cards = enriched
  .map((c) => {
    const previewRel = path.basename(c.local_preview_path);
    const badge =
      c.review_decision === "approved_new"
        ? "approved"
        : c.review_decision === "rejected"
          ? "rejected"
          : "review";
    return `<article class="card ${badge}">
  <img src="previews/${previewRel}" alt="${c.source_name}" loading="lazy" />
  <div class="body">
    <div class="badge">${c.review_decision}</div>
    <h2>${c.source_name}</h2>
    <p><b>Group:</b> ${c.target_group}${c.adrenaline_size_role ? ` / ${c.adrenaline_size_role}` : ""}</p>
    <p><b>Brand:</b> ${c.brand} · <b>Vol:</b> ${c.volume_text} · <b>Pkg:</b> ${c.package_type}</p>
    <p><b>Sugar-free:</b> ${c.sugar_free} · <b>Image:</b> ${c.image_width}×${c.image_height} · ${c.mime_type}</p>
    <p><b>Match:</b> ${c.match_status} (${c.match_reason})</p>
    <p><b>SKU:</b> ${c.proposed_sku} · unique=${c.sku_unique}</p>
    <p><b>Source:</b> <a href="${c.source_product_url}" target="_blank" rel="noreferrer">${c.source_site}</a></p>
    <p><b>Price ref:</b> ${c.source_price_reference}</p>
    <p><b>Reasons:</b> ${c.review_reasons.join(", ")}</p>
    <p class="notes">${c.notes || ""}</p>
  </div>
</article>`;
  })
  .join("\n");

const galleryHtml = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Homepage missing products — local preview</title>
  <style>
    :root { --bg:#0f1419; --card:#1a222c; --text:#e8eef5; --muted:#9aa7b5; --ok:#1f7a4c; --bad:#8a2f2f; --warn:#8a6a1f; }
    body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:linear-gradient(160deg,#0f1419,#182230); color:var(--text); }
    header { padding:24px 28px; border-bottom:1px solid #2a3542; }
    h1 { margin:0 0 8px; font-size:22px; }
    .meta { color:var(--muted); font-size:14px; line-height:1.5; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:18px; padding:22px; }
    .card { background:var(--card); border:1px solid #2a3542; border-radius:14px; overflow:hidden; display:flex; flex-direction:column; }
    .card img { width:100%; aspect-ratio:1; object-fit:contain; background:#fff; }
    .body { padding:14px 16px 18px; font-size:13px; line-height:1.45; }
    .body h2 { font-size:15px; margin:6px 0 10px; }
    .badge { display:inline-block; padding:3px 8px; border-radius:999px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
    .approved .badge { background:var(--ok); }
    .rejected .badge { background:var(--bad); }
    .review .badge { background:var(--warn); }
    a { color:#8ec8ff; }
    .notes { color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>Популярные товары — отсутствующие позиции (LOCAL PREVIEW)</h1>
    <div class="meta">
      Production / VPS / БД / блок главной / цены / seed не менялись. Товары не создавались.<br/>
      Adrenaline volumes: ${adrenalineSelection.available_standard_volumes_text.join(", ")}
      → small=${adrenalineSelection.small.volume_text}, large=${adrenalineSelection.large.volume_text}<br/>
      Import-ready (approved_new primary): ${importReady.length}
    </div>
  </header>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
writeFileSync(path.join(OUT, "gallery.html"), galleryHtml);

// review.xlsx
const sheetRows = enriched.map((c) => ({
  id: c.id,
  target_group: c.target_group,
  role: c.role,
  adrenaline_size_role: c.adrenaline_size_role || "",
  source_site: c.source_site,
  source_product_url: c.source_product_url,
  source_name: c.source_name,
  brand: c.brand,
  flavor: c.flavor,
  sugar_free: c.sugar_free,
  volume_text: c.volume_text,
  package_type: c.package_type,
  candidate_image_url: c.candidate_image_url,
  image_width: c.image_width,
  image_height: c.image_height,
  mime_type: c.mime_type,
  source_price_reference: c.source_price_reference,
  availability_reference: c.availability_reference,
  proposed_sku: c.proposed_sku,
  sku_unique: c.sku_unique,
  match_status: c.match_status,
  match_reason: c.match_reason,
  tinda_related_skus: (c.tinda_related || []).map((r) => r.sku).join(", "),
  review_decision: c.review_decision,
  review_reasons: c.review_reasons.join(" | "),
  local_original_path: c.local_original_path,
  local_preview_path: c.local_preview_path,
  notes: c.notes || "",
}));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(sheetRows);
XLSX.utils.book_append_sheet(wb, ws, "candidates");
const ws2 = XLSX.utils.json_to_sheet([
  {
    available_volumes: adrenalineSelection.available_standard_volumes_text.join(", "),
    small: adrenalineSelection.small.volume_text,
    small_sku: adrenalineSelection.small.proposed_sku,
    large: adrenalineSelection.large.volume_text,
    large_sku: adrenalineSelection.large.proposed_sku,
    mid_preview: adrenalineSelection.mid_preview_only.volume_text,
    mid_sku: adrenalineSelection.mid_preview_only.proposed_sku,
  },
]);
XLSX.utils.book_append_sheet(wb, ws2, "adrenaline_volumes");
XLSX.writeFile(wb, path.join(OUT, "review.xlsx"));

const summary = {
  generated_at: new Date().toISOString(),
  note: "LOCAL PREVIEW ONLY. Stopped after preview. Production / VPS / DB / homepage featured block / prices / seed NOT changed. No products created.",
  tinda_recheck: {
    product_count: catalogCheck.product_count,
    proposed_skus_unique: {
      "ZY-COCACOLAZERO-330-GLASS-001": true,
      "ZY-SPRITE-2000-PET-001": true,
      "ZY-ADRENALINE-250-CAN-001": true,
      "ZY-ADRENALINE-449-CAN-001": true,
      "ZY-ADRENALINE-330-CAN-001": true,
    },
    related_existing: tindaRelated,
    match_summary: {
      coca_cola_zero_033_glass: "new_product (Zero can exists — different package, not duplicate)",
      sprite_2l_pet: "new_product (Sprite 0.33 can exists — different volume/package)",
      adrenaline_rush: "new_product (no Adrenaline in TINDA)",
    },
  },
  sources_found: {
    coca_cola_zero_033_glass: [
      "napitkiopt.ru — glass 0.33 Zero (primary image)",
      "dblack.ru — glass 0.33 Zero (promo badges)",
      "vodo-ley.ru — rejected (watermark + wrong/group shot)",
      "globalalco.ru — rejected (narrow image <500)",
    ],
    sprite_2l_pet: [
      "napolke.ru — 2L PET single bottle (primary)",
      "vodovoz.ru — card exists, image 200×200 rejected",
      "napitkiopt.ru — card exists, watermark + width <500 rejected",
    ],
    adrenaline_rush: [
      "adrenalinerush.ru — official volumes 0.25 / 0.33 / 0.449",
      "ofisshop.ru — 250 / 330 / 449 single cans",
      "magnit.ru — 449 can",
      "barista-ltd.ru — 250 can",
      "winestyle.ru — cards exist, portrait images <500 width rejected for auto",
    ],
  },
  adrenaline_selection: adrenalineSelection,
  counts: {
    candidates_total: enriched.length,
    approved_new: approved.length,
    approved_new_primary_import_ready: importReady.length,
    needs_review: enriched.filter((c) => c.review_decision === "needs_review").length,
    rejected: enriched.filter((c) => c.review_decision === "rejected").length,
  },
  import_ready: importReady.map((c) => ({
    id: c.id,
    proposed_sku: c.proposed_sku,
    source_name: c.source_name,
    volume_text: c.volume_text,
    package_type: c.package_type,
    image: `${c.image_width}x${c.image_height}`,
    source_product_url: c.source_product_url,
  })),
  artifact_paths: {
    candidates_json: "data/imports/homepage-missing-products/candidates.json",
    original_dir: "data/imports/homepage-missing-products/original/",
    previews_dir: "data/imports/homepage-missing-products/previews/",
    manifest_json: "data/imports/homepage-missing-products/manifest.json",
    gallery_html: "data/imports/homepage-missing-products/gallery.html",
    review_xlsx: "data/imports/homepage-missing-products/review.xlsx",
    collection_summary_json: "data/imports/homepage-missing-products/collection-summary.json",
  },
};

writeFileSync(path.join(OUT, "collection-summary.json"), JSON.stringify(summary, null, 2));

console.log(JSON.stringify({
  ok: true,
  candidates: enriched.length,
  import_ready: importReady.length,
  adrenaline: adrenalineSelection,
  decisions: Object.fromEntries(
    ["approved_new", "needs_review", "rejected"].map((k) => [
      k,
      enriched.filter((c) => c.review_decision === k).map((c) => c.id),
    ]),
  ),
}, null, 2));
