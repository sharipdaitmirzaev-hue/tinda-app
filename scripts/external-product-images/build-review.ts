#!/usr/bin/env node
/**
 * Build external product images review workbook.
 *
 * Does NOT change production.
 * Does NOT download images to VPS.
 * Does NOT update products.image_url.
 *
 * Inputs:
 *   --products  JSON array of TINDA products (or load from DATABASE_URL)
 *   --candidates JSON array of external candidates
 *
 * Output:
 *   data/imports/external_product_images_review.xlsx
 *   data/imports/external_product_images_review.report.json
 *
 * Usage:
 *   npx tsx scripts/external-product-images/build-review.ts \
 *     --products scripts/external-product-images/products.example.json \
 *     --candidates scripts/external-product-images/candidates.example.json \
 *     --skip-probe
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import {
  aggregate_product_matches,
  detect_candidate_conflicts,
} from "../../src/lib/catalog/external-images/match";
import { fetch_and_probe_image } from "../../src/lib/catalog/external-images/image-probe";
import {
  replacement_priority_for_product,
  should_auto_prepare_replacement,
} from "../../src/lib/catalog/external-images/replacement-priority";
import type {
  ExternalImageCandidate,
  ReviewRow,
  TindaProductImageTarget,
} from "../../src/lib/catalog/external-images/types";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
    const rows = await prisma.products.findMany({
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
    return rows;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
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

  const products = await load_products(products_file);
  const candidates: ExternalImageCandidate[] = JSON.parse(
    readFileSync(path.resolve(candidates_file!), "utf8"),
  );

  const aggregates = products.map((p) =>
    aggregate_product_matches(p, candidates),
  );
  const url_conflicts = detect_candidate_conflicts(aggregates);

  // Mark conflict when candidate URL maps to multiple products
  for (const agg of aggregates) {
    if (!agg.best) continue;
    const skus = url_conflicts.get(agg.best.candidate.candidate_image_url);
    if (skus && skus.length > 1) {
      agg.final_status = "conflict";
    }
  }

  const probe_cache = new Map<string, Awaited<ReturnType<typeof fetch_and_probe_image>>>();
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
    if (result.reasons.some((r) => r.startsWith("blocked_") || r.includes("captcha"))) {
      throw new Error(`Source blocked/CAPTCHA for ${url}: ${result.reasons.join(",")}`);
    }
    return result;
  }

  // Also probe current images lightly for replacement priority
  const current_probe = new Map<string, boolean | null>();

  const rows: ReviewRow[] = [];
  const stats = {
    products: products.length,
    candidates: candidates.length,
    exact_match: 0,
    probable_match: 0,
    conflict: 0,
    no_match: 0,
    no_photo: 0,
    watermark: 0,
    low_quality: 0,
    ready_for_manual_confirm: 0,
  };

  for (const agg of aggregates) {
    if (!agg.tinda.image_url) stats.no_photo += 1;

    if (agg.final_status === "no_match" || !agg.best) {
      stats.no_match += 1;
      rows.push({
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
        review_comment: "Кандидат не найден",
      });
      continue;
    }

    // For conflicts, emit all top matches
    const emit_list =
      agg.final_status === "conflict" ? agg.matches.slice(0, 3) : [agg.best];

    for (const match of emit_list) {
      const probe_result = await probe(match.candidate.candidate_image_url);
      if (probe_result.has_watermark === true) stats.watermark += 1;
      if (probe_result.low_quality) stats.low_quality += 1;

      let current_ok: boolean | null = null;
      if (agg.tinda.image_url) {
        if (!current_probe.has(agg.tinda.image_url)) {
          if (skip_probe) current_probe.set(agg.tinda.image_url, true);
          else {
            const cur = await fetch_and_probe_image(agg.tinda.image_url);
            current_probe.set(agg.tinda.image_url, cur.ok);
            await sleep(delay_ms);
          }
        }
        current_ok = current_probe.get(agg.tinda.image_url) ?? null;
      }

      const repl = replacement_priority_for_product(agg.tinda, {
        current_image_ok: current_ok,
        current_low_quality: false,
        candidate_source_priority: match.candidate.source_priority ?? 4,
        candidate_ok: probe_result.ok,
      });

      const auto = should_auto_prepare_replacement(
        agg.final_status === "conflict" ? "conflict" : match.match_status,
        probe_result.ok,
        probe_result.has_watermark,
      );

      if (agg.final_status === "exact_match") stats.exact_match += 1;
      else if (agg.final_status === "probable_match") stats.probable_match += 1;
      else if (agg.final_status === "conflict") stats.conflict += 1;

      if (auto) stats.ready_for_manual_confirm += 1;

      const comment_parts = [
        ...match.reasons,
        ...probe_result.reasons,
        `replace:${repl.reason}`,
        `bg:${probe_result.background_hint}`,
      ];
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
        review_status: auto ? "needs_review" : "pending",
        review_comment: comment_parts.join("; "),
        replacement_priority: repl.priority,
        source_priority: match.candidate.source_priority ?? 4,
      });
    }
  }

  // Deduplicate exact_match counting (conflicts counted per emit)
  // Recompute exact/probable/conflict by product
  stats.exact_match = aggregates.filter((a) => a.final_status === "exact_match").length;
  stats.probable_match = aggregates.filter((a) => a.final_status === "probable_match").length;
  stats.conflict = aggregates.filter((a) => a.final_status === "conflict").length;
  stats.no_match = aggregates.filter((a) => a.final_status === "no_match").length;
  stats.ready_for_manual_confirm = rows.filter(
    (r) =>
      r.match_status === "exact_match" &&
      r.review_status === "needs_review" &&
      r.has_watermark !== "true",
  ).length;

  const exact = rows.filter((r) => r.match_status === "exact_match");
  const probable = rows.filter((r) => r.match_status === "probable_match");
  const none = rows.filter((r) => r.match_status === "no_match");
  const conflicts = rows.filter((r) => r.match_status === "conflict");

  const instruction = [
    {
      step: 1,
      text: "Источники передаются списком URL/candidates JSON. Приоритет: бренд → дистрибьютор → магазины → прочее.",
    },
    {
      step: 2,
      text: "Автоматически готовить к загрузке только exact_match без watermark и с image probe ok.",
    },
    {
      step: 3,
      text: "В колонке review_status выставить approved только после ручной проверки фото.",
    },
    {
      step: 4,
      text: "Скачивание: npx tsx scripts/external-product-images/download-confirmed.ts — только локально, не на VPS.",
    },
    {
      step: 5,
      text: "Production upload/image_url замена — отдельный шаг с backup, сейчас запрещён.",
    },
    {
      step: 6,
      text: "Не использовать водяные знаки, ценники, баннеры, коллажи, низкое разрешение, неверный объём/упаковку.",
    },
  ];

  mkdirSync(path.dirname(out_xlsx), { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exact), "Точные совпадения");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(probable), "Требует проверки");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(none), "Не найдено");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conflicts), "Конфликты");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instruction), "Инструкция");
  XLSX.writeFile(wb, out_xlsx);

  const report_path = out_xlsx.replace(/\.xlsx$/i, ".report.json");
  const report = {
    generated_at: new Date().toISOString(),
    out_xlsx,
    stats,
    note: "Production not modified. Images not uploaded to VPS. image_url not changed.",
  };
  writeFileSync(report_path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
