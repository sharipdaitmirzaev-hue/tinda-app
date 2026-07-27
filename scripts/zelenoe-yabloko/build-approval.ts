#!/usr/bin/env node
/**
 * Build approval workbook from ZY images review.
 *
 * Only exact_match + recommended_approve + safe image checks.
 * review_status = pending (human sets approved/rejected).
 *
 * Does NOT change production / VPS / image_url.
 * Does NOT download images.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fetch_and_probe_image } from "../../src/lib/catalog/external-images/image-probe";
import {
  normalize_package,
  parse_volume_ml,
  sugar_free_flag,
} from "../../src/lib/catalog/external-images/normalize";

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

function source_label(url: string): string {
  const u = (url || "").trim();
  if (!u) return "none";
  if (u.includes("metro-cc.ru") || u.includes("cdn.metro")) return "metro_cdn";
  if (u.includes("zelenoeyabloko.ru")) return "zelenoeyabloko.ru";
  if (u.includes("/uploads/products/")) return "tinda_uploads";
  if (/^https?:\/\//i.test(u)) return "external_cdn";
  return "other";
}

function truthy_yes(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

function watermark_false(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  // exclude explicit true; unknown/false/empty allowed for recommended set
  return s !== "true" && s !== "yes" && s !== "1";
}

async function main() {
  const review_path = path.resolve(
    arg("review", "data/imports/zelenoe_yabloko_gazirovannye_images_review.xlsx")!,
  );
  const candidates_path = path.resolve(
    arg("candidates", "data/imports/zelenoe_yabloko_gazirovannye_candidates.json")!,
  );
  const out_path = path.resolve(
    arg("out", "data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx")!,
  );
  const delay_ms = Number(arg("delay-ms", "350"));
  const skip_current_probe = process.argv.includes("--skip-current-probe");

  const wb = XLSX.readFile(review_path);
  const exact = XLSX.utils.sheet_to_json(wb.Sheets["Точные совпадения"] || {}, {
    defval: "",
  }) as Record<string, unknown>[];
  const candidates = JSON.parse(readFileSync(candidates_path, "utf8")) as Array<{
    candidate_image_url?: string;
    source_name?: string;
    volume_text?: string;
    package_type?: string;
  }>;

  const by_url = new Map(
    candidates.map((c) => [String(c.candidate_image_url || ""), c]),
  );

  const filtered = exact.filter((r) => {
    if (String(r.match_status) !== "exact_match") return false;
    if (!truthy_yes(r.recommended_approve)) return false;
    if (!watermark_false(r.has_watermark)) return false;
    const w = Number(r.image_width) || 0;
    const h = Number(r.image_height) || 0;
    if (w < 500 || h < 500) return false;

    const comment = String(r.review_comment || "");
    // Require matcher confirmed volume/package; exclude sugar asymmetry/conflict
    if (!comment.includes("volume_exact") && !comment.includes("volume_near")) {
      return false;
    }
    if (!comment.includes("package_exact")) return false;
    if (comment.includes("sugar_conflict")) return false;
    if (comment.includes("sugar_asymmetric")) return false;

    const cand = by_url.get(String(r.candidate_image_url || ""));
    if (cand) {
      const tv = parse_volume_ml(String(r.tinda_volume || ""));
      const sv = parse_volume_ml(cand.volume_text || "");
      if (tv != null && sv != null && tv !== sv) return false;
      const tp = normalize_package(String(r.tinda_name || "") + " " + String(r.tinda_volume || ""));
      // package from tinda name often includes ПЭТ; also check candidate
      const sp = normalize_package(cand.package_type || "");
      if (sp && tp && sp !== tp) {
        // soft: also try package from review comment already required package_exact
      }
      const ts = sugar_free_flag(String(r.tinda_name || ""));
      const ss = sugar_free_flag(String(r.source_name || ""));
      if (ts != null && ss != null && ts !== ss) return false;
    }
    return true;
  });

  const rows: Record<string, unknown>[] = [];
  for (const r of filtered) {
    const current_url = String(r.current_image_url || "");
    const candidate_url = String(r.candidate_image_url || "");
    let current_w: number | null = null;
    let current_h: number | null = null;
    let current_format = "";
    let current_ok = "";

    if (!skip_current_probe && current_url) {
      try {
        const cur = await fetch_and_probe_image(current_url);
        current_w = cur.width;
        current_h = cur.height;
        current_format = cur.format || "";
        current_ok = cur.ok ? "ok" : `fail:${cur.reasons.join(",")}`;
        await sleep(delay_ms);
      } catch (e) {
        current_ok = e instanceof Error ? e.message : String(e);
      }
    } else if (!current_url) {
      current_ok = "missing";
    } else {
      current_ok = "probe_skipped";
    }

    const comment = String(r.review_comment || "");
    const reasons: string[] = [];
    if (String(r.flag_metro_cdn) === "yes") reasons.push("current_metro_cdn");
    if (String(r.flag_better_photo) === "yes") reasons.push("candidate_better_or_needed");
    if (comment.includes("replace:current_broken")) reasons.push("current_broken_or_unreachable");
    if (comment.includes("replace:external_cdn")) reasons.push("current_external_cdn");
    if (comment.includes("replace:no_photo")) reasons.push("tinda_no_photo");
    reasons.push(
      `candidate_${r.image_width}x${r.image_height}_${r.image_format || "img"}`,
    );

    rows.push({
      tinda_sku: r.tinda_sku,
      tinda_name: r.tinda_name,
      tinda_product_id: r.tinda_product_id,
      current_image_url: current_url,
      source_name: r.source_name,
      candidate_image_url: candidate_url,
      current_image_source: source_label(current_url),
      candidate_image_source: source_label(candidate_url) || "zelenoeyabloko.ru",
      current_image_width: current_w,
      current_image_height: current_h,
      current_image_format: current_format,
      current_image_status: current_ok,
      candidate_image_width: r.image_width,
      candidate_image_height: r.image_height,
      candidate_image_format: r.image_format,
      recommendation_reason: reasons.join("; "),
      match_status: r.match_status,
      match_score: r.match_score,
      has_watermark: r.has_watermark,
      recommended_approve: "true",
      review_status: "pending",
      review_comment:
        "Оставьте pending или выставьте approved / rejected. Не применять на production автоматически.",
      source_product_url: r.source_product_url,
      source_site: r.source_site,
      source_price_reference: r.source_price_reference || "",
    });
  }

  const instruction = [
    {
      step: 1,
      text: "В колонке review_status выставьте approved или rejected. Сейчас везде pending.",
    },
    {
      step: 2,
      text: "После approved: npm run external-images:download -- --review data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx --status approved",
    },
    {
      step: 3,
      text: "Затем: npm run external-images:prepare -- --review data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx",
    },
    {
      step: 4,
      text: "Production / VPS / image_url не менять этими командами.",
    },
  ];

  mkdirSync(path.dirname(out_path), { recursive: true });
  const out_wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    out_wb,
    XLSX.utils.json_to_sheet(rows),
    "К одобрению",
  );
  XLSX.utils.book_append_sheet(
    out_wb,
    XLSX.utils.json_to_sheet(instruction),
    "Инструкция",
  );
  XLSX.writeFile(out_wb, out_path);

  const report = {
    generated_at: new Date().toISOString(),
    out_path,
    review_path,
    candidates_path,
    rows: rows.length,
    all_pending: rows.every((r) => r.review_status === "pending"),
    production_changed: false,
    skus: rows.map((r) => r.tinda_sku),
  };
  writeFileSync(
    out_path.replace(/\.xlsx$/i, ".report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
