#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const ROOT = "data/imports/zelenoe-yabloko-juice";

const decisions = JSON.parse(readFileSync(`${ROOT}/review-decisions.json`, "utf8"));
const gallery = JSON.parse(readFileSync(`${ROOT}/gallery-data.json`, "utf8"));
const candidates = JSON.parse(readFileSync(`${ROOT}/candidates.json`, "utf8"));
const summary = JSON.parse(readFileSync(`${ROOT}/collection-summary.json`, "utf8"));
const reportPrev = existsSync(`${ROOT}/second-pass-report.json`)
  ? JSON.parse(readFileSync(`${ROOT}/second-pass-report.json`, "utf8"))
  : {};

const imported = new Set([
  ...JSON.parse(readFileSync(`${ROOT}/approved-apply-report.json`, "utf8")).created_skus,
  ...JSON.parse(
    readFileSync(`${ROOT}/missing-categories-apply-report.json`, "utf8"),
  ).created_skus,
]);
const importedUrls = new Set();
for (const rel of [
  "approved-new-import-batch.json",
  "missing-categories-import-batch.json",
]) {
  const p = `${ROOT}/${rel}`;
  if (!existsSync(p)) continue;
  const b = JSON.parse(readFileSync(p, "utf8"));
  for (const it of b.items || []) {
    if (it.source_product_url) importedUrls.add(it.source_product_url);
  }
}

const counts = {
  approved_existing: decisions.items.filter(
    (i) => i.review_status === "approved_existing",
  ).length,
  approved_new: decisions.items.filter((i) => i.review_status === "approved_new")
    .length,
  needs_review: decisions.items.filter((i) => i.review_status === "needs_review")
    .length,
  rejected: decisions.items.filter((i) => i.review_status === "rejected").length,
};
decisions.counts = counts;
decisions.generated_at = new Date().toISOString();
decisions.note =
  "Second-pass local re-review of needs_review (package + images). Production not modified.";

const byDec = new Map(decisions.items.map((d) => [d.source_product_url, d]));
for (const c of gallery.cards) {
  const d = byDec.get(c.source_product_url);
  if (!d) continue;
  c.review_status = d.review_status;
  c.review_comment = d.review_comment;
}
gallery.stats = { ...(gallery.stats || {}), auto_review: counts };

const cardByUrl = new Map(gallery.cards.map((c) => [c.source_product_url, c]));
const candByUrl = new Map(
  candidates.candidates.map((c) => [c.source_product_url, c]),
);

const secondRows = [];
for (const i of decisions.items) {
  if (i.review_status !== "approved_new") continue;
  const url = i.source_product_url;
  if (importedUrls.has(url)) continue;
  const card = cardByUrl.get(url);
  const cand = candByUrl.get(url);
  const sku = card?.proposed_sku || i.proposed_sku || "";
  if (imported.has(sku)) continue;
  secondRows.push({
    proposed_sku: sku,
    source_name: i.source_name,
    brand: card?.brand || cand?.brand || "",
    flavor: card?.flavor || cand?.flavor || "",
    volume_text: card?.volume_text || cand?.volume_text || "",
    volume_ml: cand?.volume_ml ?? null,
    package_type: card?.package_type || cand?.package_type || "",
    package_code: cand?.package_code || "",
    product_type: card?.product_type || cand?.product_type || "",
    is_kids_line: !!card?.is_kids_line,
    source_product_url: url,
    candidate_image_url: i.candidate_image_url,
    local_original_path: i.local_original_path,
    width: i.width,
    height: i.height,
    sha256: i.sha256,
    decision_reason: i.decision_reason,
    package_inference: i.second_pass_package
      ? JSON.stringify(i.second_pass_package)
      : "",
    sales_status: "showcase",
    price_amount: null,
    units_per_package: 1,
    package_requires_review: true,
  });
}

const carton_detected =
  decisions.items.filter((i) => i.second_pass_package?.package_type === "carton")
    .length ||
  reportPrev.carton_detected ||
  0;
const package_resolved =
  decisions.items.filter(
    (i) =>
      i.second_pass_package?.package_type &&
      i.second_pass_package.package_type !== "unknown",
  ).length ||
  reportPrev.package_resolved ||
  0;
const improved_images = decisions.items.filter(
  (i) => i.second_pass_image?.improved,
).length;

const probable_dupes = decisions.items.filter(
  (i) =>
    i.review_status === "needs_review" &&
    (String(i.decision_reason || "").includes("probable") ||
      i.match_status === "probable_match" ||
      (Array.isArray(i.mismatches) &&
        i.mismatches.some((m) => /dup|probable/i.test(m)))),
).length;

const wbDec = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wbDec,
  XLSX.utils.json_to_sheet(
    decisions.items.map((i) => ({
      source_index: i.source_index,
      source_name: i.source_name,
      source_product_url: i.source_product_url,
      review_status: i.review_status,
      decision_reason: i.decision_reason,
      review_comment: i.review_comment,
      proposed_sku:
        cardByUrl.get(i.source_product_url)?.proposed_sku || i.proposed_sku || "",
      width: i.width,
      height: i.height,
      match_status: i.match_status,
      mismatches: Array.isArray(i.mismatches) ? i.mismatches.join("|") : "",
      second_pass_package: i.second_pass_package
        ? JSON.stringify(i.second_pass_package)
        : "",
      second_pass_image: i.second_pass_image
        ? JSON.stringify(i.second_pass_image)
        : "",
    })),
  ),
  "decisions",
);
XLSX.writeFile(wbDec, `${ROOT}/review-decisions.xlsx`);

const wbImg = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wbImg,
  XLSX.utils.json_to_sheet([
    {
      needs_review_before: 171,
      approved_new: counts.approved_new,
      needs_review: counts.needs_review,
      rejected: counts.rejected,
      carton_detected,
      improved_images,
      package_resolved,
      second_pass_ready: secondRows.length,
    },
  ]),
  "second_pass_summary",
);
XLSX.utils.book_append_sheet(
  wbImg,
  XLSX.utils.json_to_sheet(
    gallery.cards.map((c) => ({
      source_name: c.source_name,
      brand: c.brand,
      flavor: c.flavor,
      volume_text: c.volume_text,
      package_type: c.package_type,
      product_type: c.product_type,
      proposed_sku: c.proposed_sku,
      match_status: c.match_status,
      review_status: c.review_status,
      width: c.width,
      height: c.height,
      candidate_image_url: c.candidate_image_url,
      source_product_url: c.source_product_url,
    })),
  ),
  "cards",
);
XLSX.writeFile(wbImg, `${ROOT}/images-review.xlsx`);

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb2,
  XLSX.utils.json_to_sheet(secondRows),
  "approved_new",
);
XLSX.utils.book_append_sheet(
  wb2,
  XLSX.utils.json_to_sheet([
    {
      note: "Only new approved_new not yet imported. Imported SKUs/URLs excluded.",
      rows: secondRows.length,
      imported_skus: imported.size,
    },
  ]),
  "meta",
);
XLSX.writeFile(wb2, `${ROOT}/second-pass-approved-new.xlsx`);

summary.generated_at = new Date().toISOString();
summary.note =
  "LOCAL second-pass complete. No production / VPS / DB / image_url / price / seed changes. Nothing imported in this step.";
summary.auto_review = counts;
summary.unknown_package = candidates.candidates.filter(
  (c) => !String(c.package_type || "").trim(),
).length;
summary.second_pass = {
  needs_review_before: 171,
  carton_detected,
  package_resolved: reportPrev.package_resolved || package_resolved,
  improved_images: reportPrev.improved_images ?? improved_images,
  package_sources: reportPrev.package_sources || {},
  needs_review_after: counts.needs_review,
  approved_new_after: counts.approved_new,
  rejected_after: counts.rejected,
  second_pass_approved_new_ready: secondRows.length,
  second_pass_xlsx: path.resolve(`${ROOT}/second-pass-approved-new.xlsx`),
};
summary.artifacts = {
  ...(summary.artifacts || {}),
  second_pass_xlsx: path.resolve(`${ROOT}/second-pass-approved-new.xlsx`),
  second_pass_report: path.resolve(`${ROOT}/second-pass-report.json`),
};

const report = {
  generated_at: new Date().toISOString(),
  production_changed: false,
  needs_review_before: 171,
  carton_detected,
  package_resolved: reportPrev.package_resolved || package_resolved,
  improved_images: reportPrev.improved_images ?? improved_images,
  package_sources: reportPrev.package_sources || {},
  approved_new_after: counts.approved_new,
  needs_review_after: counts.needs_review,
  rejected_after: counts.rejected,
  probable_dupes,
  second_pass_batch_ready: secondRows.length,
  imported_skus_excluded_count: imported.size,
  imported_skus_in_second_batch: secondRows.filter((r) =>
    imported.has(r.proposed_sku),
  ).length,
  paths: {
    review_decisions: path.resolve(`${ROOT}/review-decisions.json`),
    images_review_xlsx: path.resolve(`${ROOT}/images-review.xlsx`),
    gallery_html: path.resolve(`${ROOT}/gallery.html`),
    collection_summary: path.resolve(`${ROOT}/collection-summary.json`),
    second_pass_xlsx: path.resolve(`${ROOT}/second-pass-approved-new.xlsx`),
    second_pass_report: path.resolve(`${ROOT}/second-pass-report.json`),
  },
  before_counts: {
    approved_existing: 0,
    approved_new: 50,
    needs_review: 171,
    rejected: 9,
  },
  after_counts: counts,
};

writeFileSync(`${ROOT}/review-decisions.json`, JSON.stringify(decisions, null, 2) + "\n");
writeFileSync(`${ROOT}/gallery-data.json`, JSON.stringify(gallery, null, 2) + "\n");
writeFileSync(`${ROOT}/collection-summary.json`, JSON.stringify(summary, null, 2) + "\n");
writeFileSync(`${ROOT}/second-pass-report.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(
  `${ROOT}/images-review.report.json`,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      out_xlsx: path.resolve(`${ROOT}/images-review.xlsx`),
      note: "Updated by juice second-pass (local only).",
      counts,
      second_pass: summary.second_pass,
    },
    null,
    2,
  ) + "\n",
);

console.log(JSON.stringify(report, null, 2));
