#!/usr/bin/env node
/**
 * Build external product images review workbook.
 *
 * Does NOT change production.
 * Does NOT download images to VPS.
 * Does NOT update products.image_url.
 * review_status is always "pending" — human sets approved/rejected.
 *
 * Usage:
 *   npm run external-images:review -- \
 *     --products data/imports/tinda_active_products.snapshot.json \
 *     --candidates data/imports/zelenoe_yabloko_gazirovannye_candidates.json \
 *     --out data/imports/zelenoe_yabloko_gazirovannye_images_review.xlsx
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import {
  aggregate_product_matches,
  detect_candidate_conflicts,
  score_candidate_match,
} from "../../src/lib/catalog/external-images/match";
import { fetch_and_probe_image } from "../../src/lib/catalog/external-images/image-probe";
import { replacement_priority_for_product } from "../../src/lib/catalog/external-images/replacement-priority";
import { normalize_brand } from "../../src/lib/catalog/external-images/normalize";
import type {
  ExternalImageCandidate,
  ReviewRow,
  TindaProductImageTarget,
} from "../../src/lib/catalog/external-images/types";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

type LooseCandidate = ExternalImageCandidate & {
  brand?: string | null;
  flavor?: string | null;
  volume_text?: string | null;
  package_type?: string | null;
  source_price_reference?: number | string | null;
  availability_reference?: string | null;
};

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalize_candidate(raw: LooseCandidate): ExternalImageCandidate & {
  source_price_reference?: string;
  availability_reference?: string;
} {
  return {
    source_site: raw.source_site,
    source_product_url: raw.source_product_url,
    candidate_image_url: raw.candidate_image_url,
    source_name: raw.source_name,
    source_brand: raw.source_brand ?? raw.brand ?? null,
    source_flavor: raw.source_flavor ?? raw.flavor ?? null,
    source_volume: raw.source_volume ?? raw.volume_text ?? null,
    source_package: raw.source_package ?? raw.package_type ?? null,
    source_sku: raw.source_sku ?? null,
    source_priority: raw.source_priority ?? 4,
    source_price_reference:
      raw.source_price_reference == null
        ? ""
        : String(raw.source_price_reference),
    availability_reference: raw.availability_reference || "",
  };
}

function is_metro_cdn(url: string | null | undefined): boolean {
  const u = (url || "").toLowerCase();
  return u.includes("metro-cc.ru") || u.includes("cdn.metro");
}

function is_external_cdn(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u) return false;
  return /^https?:\/\//i.test(u) && !u.includes("/uploads/products/");
}

async function load_products(file: string | null): Promise<TindaProductImageTarget[]> {
  if (file) {
    return JSON.parse(readFileSync(path.resolve(file), "utf8"));
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("Provide --products JSON or DATABASE_URL");
  }
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await prisma.products.findMany({
      where: { is_active: true },
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        volume_text: true,
        package_type: true,
        image_url: true,
        is_active: true,
        sales_status: true,
      },
      orderBy: { sku: "asc" },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function candidate_key(c: ExternalImageCandidate): string {
  return `${c.source_product_url}||${c.candidate_image_url}||${c.source_name}`;
}

async function main() {
  if (process.argv.includes("--apply-production")) {
    throw new Error("Production apply is disabled.");
  }

  const products_file = arg("products");
  const candidates_file = arg(
    "candidates",
    "scripts/external-product-images/candidates.example.json",
  );
  const out_xlsx = path.resolve(
    arg("out", "data/imports/external_product_images_review.xlsx")!,
  );
  const delay_ms = Number(arg("delay-ms", "400"));
  const skip_probe = process.argv.includes("--skip-probe");
  const progress_path = out_xlsx.replace(/\.xlsx$/i, ".progress.json");

  const products = await load_products(products_file);
  const candidates_raw = JSON.parse(
    readFileSync(path.resolve(candidates_file!), "utf8"),
  ) as LooseCandidate[];
  const candidates = candidates_raw.map(normalize_candidate);

  const aggregates = products.map((p) =>
    aggregate_product_matches(p, candidates),
  );
  const url_conflicts = detect_candidate_conflicts(aggregates);
  for (const agg of aggregates) {
    if (!agg.best) continue;
    const skus = url_conflicts.get(agg.best.candidate.candidate_image_url);
    if (skus && skus.length > 1) agg.final_status = "conflict";
  }

  const probe_cache = new Map<
    string,
    Awaited<ReturnType<typeof fetch_and_probe_image>>
  >();

  async function probe(url: string) {
    if (skip_probe) {
      return {
        ok: true,
        url,
        http_status: 200,
        mime: "image/png",
        format: "png" as const,
        width: 800,
        height: 800,
        bytes: 10000,
        has_watermark: null,
        low_quality: false,
        placeholder_like: false,
        background_hint: "unknown" as const,
        reasons: ["probe_skipped"],
      };
    }
    if (probe_cache.has(url)) return probe_cache.get(url)!;
    const result = await fetch_and_probe_image(url);
    probe_cache.set(url, result);
    await sleep(delay_ms);
    if (
      result.reasons.some(
        (r) => r.startsWith("blocked_") || r.includes("captcha"),
      )
    ) {
      writeFileSync(
        progress_path,
        JSON.stringify(
          {
            stopped: true,
            reason: result.reasons.join(","),
            url,
            probed: probe_cache.size,
          },
          null,
          2,
        ),
      );
      throw new Error(
        `Source blocked/CAPTCHA for ${url}: ${result.reasons.join(",")}`,
      );
    }
    return result;
  }

  const current_probe = new Map<string, boolean | null>();
  const rows: Array<
    ReviewRow & {
      source_price_reference?: string;
      availability_reference?: string;
      flag_metro_cdn?: string;
      flag_better_photo?: string;
      recommended_approve?: string;
    }
  > = [];

  const stats = {
    products: products.length,
    candidates: candidates.length,
    exact_match: 0,
    probable_match: 0,
    conflict: 0,
    no_match: 0,
    new_product: 0,
    no_photo: 0,
    watermark: 0,
    below_500: 0,
    low_quality: 0,
    metro_cdn_current: 0,
    better_photo: 0,
    recommended_approve: 0,
  };

  const matched_candidate_keys = new Set<string>();

  for (const agg of aggregates) {
    if (!agg.tinda.image_url) stats.no_photo += 1;

    if (agg.final_status === "no_match" || !agg.best) {
      stats.no_match += 1;
      continue; // filled later (brand-filtered)
    }

    const emit_list =
      agg.final_status === "conflict" ? agg.matches.slice(0, 3) : [agg.best];

    for (const match of emit_list) {
      matched_candidate_keys.add(candidate_key(match.candidate));
      const probe_result = await probe(match.candidate.candidate_image_url);
      if (probe_result.has_watermark === true) stats.watermark += 1;
      if (probe_result.low_quality) stats.low_quality += 1;
      if (
        (probe_result.width != null && probe_result.width < 500) ||
        (probe_result.height != null && probe_result.height < 500)
      ) {
        stats.below_500 += 1;
      }

      let current_ok: boolean | null = null;
      let current_w: number | null = null;
      if (agg.tinda.image_url) {
        if (!current_probe.has(agg.tinda.image_url)) {
          if (skip_probe) current_probe.set(agg.tinda.image_url, true);
          else {
            const cur = await fetch_and_probe_image(agg.tinda.image_url);
            current_probe.set(agg.tinda.image_url, cur.ok);
            current_w = cur.width;
            await sleep(delay_ms);
          }
        }
        current_ok = current_probe.get(agg.tinda.image_url) ?? null;
      }

      const metro = is_metro_cdn(agg.tinda.image_url);
      if (metro) stats.metro_cdn_current += 1;

      const repl = replacement_priority_for_product(agg.tinda, {
        current_image_ok: current_ok,
        current_low_quality: false,
        candidate_source_priority: match.candidate.source_priority ?? 4,
        candidate_ok: probe_result.ok,
      });

      let better = false;
      if (agg.final_status === "exact_match" && probe_result.ok) {
        if (!agg.tinda.image_url) better = true;
        if (metro || is_external_cdn(agg.tinda.image_url)) better = true;
        if (
          current_w &&
          probe_result.width &&
          probe_result.width > current_w * 1.1
        ) {
          better = true;
        }
        if (current_ok === false) better = true;
      }
      if (better) stats.better_photo += 1;

      const recommend =
        agg.final_status === "exact_match" &&
        probe_result.ok &&
        probe_result.has_watermark !== true &&
        !probe_result.low_quality;
      if (recommend) stats.recommended_approve += 1;

      const loose = match.candidate as LooseCandidate & {
        source_price_reference?: string;
        availability_reference?: string;
      };

      const comment_parts = [
        ...match.reasons,
        ...probe_result.reasons,
        `replace:${repl.reason}`,
        `bg:${probe_result.background_hint}`,
      ];
      if (metro) comment_parts.push("FLAG:current_metro_cdn");
      if (better) comment_parts.push("FLAG:better_or_needed_photo");
      if (recommend) comment_parts.push("FLAG:recommended_approve");
      if (agg.final_status === "conflict") {
        comment_parts.unshift("CONFLICT: не применять автоматически");
      }

      rows.push({
        tinda_product_id: agg.tinda.id,
        tinda_sku: agg.tinda.sku,
        tinda_name: agg.tinda.name,
        tinda_brand: agg.tinda.brand || "",
        tinda_volume: agg.tinda.volume_text || "",
        current_image_url: agg.tinda.image_url || "",
        source_site: match.candidate.source_site,
        source_product_url: match.candidate.source_product_url,
        candidate_image_url: match.candidate.candidate_image_url,
        source_name: match.candidate.source_name,
        match_status: agg.final_status,
        match_score: match.match_score,
        image_width: probe_result.width,
        image_height: probe_result.height,
        image_format: probe_result.format || "",
        has_watermark:
          probe_result.has_watermark === null
            ? "unknown"
            : String(probe_result.has_watermark),
        review_status: "pending",
        review_comment: comment_parts.join("; "),
        replacement_priority: repl.priority,
        source_priority: match.candidate.source_priority ?? 4,
        source_price_reference: loose.source_price_reference || "",
        availability_reference: loose.availability_reference || "",
        flag_metro_cdn: metro ? "yes" : "",
        flag_better_photo: better ? "yes" : "",
        recommended_approve: recommend ? "yes" : "",
      });
    }
  }

  stats.exact_match = aggregates.filter((a) => a.final_status === "exact_match").length;
  stats.probable_match = aggregates.filter(
    (a) => a.final_status === "probable_match",
  ).length;
  stats.conflict = aggregates.filter((a) => a.final_status === "conflict").length;

  // New products = candidates with no non-no_match against TINDA catalog
  const new_rows: typeof rows = [];
  for (const c of candidates) {
    if (matched_candidate_keys.has(candidate_key(c))) continue;
    const hits = products
      .map((p) => score_candidate_match(p, c))
      .filter((m) => m.match_status !== "no_match");
    if (hits.length > 0) {
      // already covered via aggregates as probable/exact for some product
      continue;
    }
    stats.new_product += 1;
    let probe_result = {
      width: null as number | null,
      height: null as number | null,
      format: "" as string,
      has_watermark: null as boolean | null,
      ok: false,
      low_quality: false,
      reasons: ["not_probed_new_product"] as string[],
    };
    if (!skip_probe && c.candidate_image_url) {
      const p = await probe(c.candidate_image_url);
      probe_result = {
        width: p.width,
        height: p.height,
        format: p.format || "",
        has_watermark: p.has_watermark,
        ok: p.ok,
        low_quality: p.low_quality,
        reasons: p.reasons,
      };
      if (p.has_watermark === true) stats.watermark += 1;
      if (p.low_quality) stats.low_quality += 1;
      if (
        (p.width != null && p.width < 500) ||
        (p.height != null && p.height < 500)
      ) {
        stats.below_500 += 1;
      }
    }
    const loose = c as LooseCandidate & {
      source_price_reference?: string;
      availability_reference?: string;
    };
    new_rows.push({
      tinda_product_id: "",
      tinda_sku: "",
      tinda_name: "",
      tinda_brand: "",
      tinda_volume: "",
      current_image_url: "",
      source_site: c.source_site,
      source_product_url: c.source_product_url,
      candidate_image_url: c.candidate_image_url,
      source_name: c.source_name,
      match_status: "no_match",
      match_score: 0,
      image_width: probe_result.width,
      image_height: probe_result.height,
      image_format: probe_result.format,
      has_watermark:
        probe_result.has_watermark === null
          ? "unknown"
          : String(probe_result.has_watermark),
      review_status: "pending",
      review_comment: [
        "new_product_not_in_tinda",
        ...probe_result.reasons,
        loose.availability_reference
          ? `availability_reference=${loose.availability_reference}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      source_price_reference: loose.source_price_reference || "",
      availability_reference: loose.availability_reference || "",
      flag_metro_cdn: "",
      flag_better_photo: "",
      recommended_approve: "",
    });
  }

  // Не найдено: TINDA products of brands present in candidates, without a match
  const candidate_brands = new Set(
    candidates
      .map((c) => normalize_brand(c.source_brand || ""))
      .filter(Boolean),
  );
  const none_rows: typeof rows = [];
  for (const agg of aggregates) {
    if (agg.final_status !== "no_match") continue;
    const b = normalize_brand(agg.tinda.brand || "");
    if (!b || !candidate_brands.has(b)) continue;
    none_rows.push({
      tinda_product_id: agg.tinda.id,
      tinda_sku: agg.tinda.sku,
      tinda_name: agg.tinda.name,
      tinda_brand: agg.tinda.brand || "",
      tinda_volume: agg.tinda.volume_text || "",
      current_image_url: agg.tinda.image_url || "",
      source_site: "",
      source_product_url: "",
      candidate_image_url: "",
      source_name: "",
      match_status: "no_match",
      match_score: 0,
      image_width: null,
      image_height: null,
      image_format: "",
      has_watermark: "",
      review_status: "pending",
      review_comment: is_metro_cdn(agg.tinda.image_url)
        ? "Кандидат не найден; current_metro_cdn"
        : "Кандидат не найден в источнике",
      flag_metro_cdn: is_metro_cdn(agg.tinda.image_url) ? "yes" : "",
      flag_better_photo: "",
      recommended_approve: "",
    });
  }

  const exact = rows.filter((r) => r.match_status === "exact_match");
  const probable = rows.filter((r) => r.match_status === "probable_match");
  const conflicts = rows.filter((r) => r.match_status === "conflict");

  // annotate new_product status in sheet via review_comment already; expose match_status column as new_product label
  const news = new_rows.map((r) => ({
    ...r,
    match_status: "new_product",
  }));

  const instruction = [
    {
      step: 1,
      text: "review_status всегда pending. Вручную выставить approved или rejected.",
    },
    {
      step: 2,
      text: "Одобрять только exact_match с probe ok, без watermark/ценника/баннера, ≥500×500.",
    },
    {
      step: 3,
      text: "Не заменять фото автоматически. Скачивание только после approved, локально.",
    },
    {
      step: 4,
      text: "source_price_reference — справочно, не цена ТИНДА.",
    },
    {
      step: 5,
      text: "FLAG:current_metro_cdn — текущее фото с CDN METRO. FLAG:better_or_needed_photo — кандидат лучше/нужен.",
    },
    {
      step: 6,
      text: "Production / VPS / image_url этим отчётом не меняются.",
    },
  ];

  mkdirSync(path.dirname(out_xlsx), { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exact), "Точные совпадения");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(probable), "Требует проверки");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(news), "Новые товары");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conflicts), "Конфликты");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(none_rows), "Не найдено");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instruction), "Инструкция");
  XLSX.writeFile(wb, out_xlsx);

  const report = {
    generated_at: new Date().toISOString(),
    out_xlsx,
    candidates_file: path.resolve(candidates_file!),
    products_file: products_file ? path.resolve(products_file) : null,
    stats,
    note: "Production not modified. Images not uploaded. image_url not changed. review_status=pending.",
  };
  writeFileSync(out_xlsx.replace(/\.xlsx$/i, ".report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
