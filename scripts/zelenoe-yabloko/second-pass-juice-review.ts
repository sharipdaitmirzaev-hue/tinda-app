#!/usr/bin/env node
/**
 * Second-pass local review for juice needs_review items:
 *  - re-detect package (carton/pet/glass/can/pouch)
 *  - re-check / upgrade images when possible
 *  - promote clean new_product rows to approved_new
 *
 * LOCAL ONLY. Does NOT change production / VPS / DB / image_url / seed.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import {
  build_zy_sku,
  detect_juice_product_type,
  infer_juice_package,
  parse_zy_product_name,
  type JuicePackageType,
} from "../../src/lib/catalog/external-images/zy-parse-name";
import {
  normalize_package,
  parse_volume_ml,
} from "../../src/lib/catalog/external-images/normalize";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve("data/imports/zelenoe-yabloko-juice");
const SHOP_ID = 4;
const USER_AGENT =
  "TINDA-external-images/1.0 (+https://tindagrupp.ru; juice-second-pass-local)";
const MIN_SIDE = 500;
const DETAIL_DELAY_MS = Number(process.env.ZY_DETAIL_DELAY_MS || 350);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function load_json<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function product_id_from_url(url: string): string | null {
  const m = String(url || "").match(/\/product\/(\d+)/);
  return m ? m[1]! : null;
}

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

function is_image_magic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return true;
  }
  return (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

async function fetch_json(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  if (res.status >= 400) {
    throw new Error(`http_${res.status}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function fetch_bytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!is_image_magic(buf)) return null;
    return buf;
  } catch {
    return null;
  }
}

function image_url_variants(url: string): string[] {
  const u = String(url || "").trim();
  if (!u) return [];
  const out = [u, u.split("?")[0]!];
  out.push(u.replace("/webp/cropped/", "/webp/files/cropped/"));
  out.push(u.replace("/webp/files/cropped/", "/webp/cropped/"));
  out.push(u.replace(/\/webp\/(?:files\/)?cropped\//, "/webp/files/"));
  out.push(u.replace(/\/webp\/(?:files\/)?cropped\//, "/files/"));
  return [...new Set(out.filter(Boolean))];
}

type ApiDetail = {
  description: string;
  attributes_text: string;
  images: string[];
  title: string;
};

async function fetch_product_detail(id: string): Promise<ApiDetail | null> {
  try {
    const data = await fetch_json(
      `https://zelenoeyabloko.ru/api/store/products/${id}?shop_id=${SHOP_ID}`,
    );
    const attrs = Array.isArray(data.attributes) ? data.attributes : [];
    const attributes_text = attrs
      .map((a) => {
        const row = a as { title?: string; value?: string };
        return `${row.title || ""} ${row.value || ""}`;
      })
      .join(" | ");
    const images: string[] = [];
    if (typeof data.image === "string" && data.image) images.push(data.image);
    if (Array.isArray(data.images)) {
      for (const x of data.images) {
        if (typeof x === "string" && x) images.push(x);
      }
    }
    return {
      description: String(data.description || ""),
      attributes_text,
      images: [...new Set(images)],
      title: String(data.title || ""),
    };
  } catch {
    return null;
  }
}

function load_imported_skus(): Set<string> {
  const skus = new Set<string>();
  for (const rel of [
    "approved-apply-report.json",
    "missing-categories-apply-report.json",
  ]) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) continue;
    const report = load_json<{ created_skus?: string[] }>(p);
    for (const s of report.created_skus || []) skus.add(s);
  }
  return skus;
}

function package_display(type: JuicePackageType): string {
  if (type === "unknown") return "";
  return type;
}

function rebuild_skus(
  cards: Array<{
    brand: string;
    volume_text: string;
    package_type: string;
    proposed_sku: string;
    source_name: string;
  }>,
  reserved: Set<string>,
) {
  const used = new Set<string>([...reserved]);
  const counters = new Map<string, number>();
  for (const card of cards) {
    const parsed = parse_zy_product_name(card.source_name);
    const brand = card.brand || parsed.brand;
    const volume_ml =
      parse_volume_ml(card.volume_text) ?? parsed.volume_ml;
    const code =
      normalize_package(card.package_type).toUpperCase() ||
      parsed.package_code ||
      "UNK";
    const pkg_code =
      code === "CARTON" ||
      code === "PET" ||
      code === "GLASS" ||
      code === "CAN" ||
      code === "POUCH" ||
      code === "OTHER" ||
      code === "PACK"
        ? code
        : parsed.package_code || "UNK";
    const prefix = `${brand}|${volume_ml}|${pkg_code}`;
    let seq = (counters.get(prefix) || 0) + 1;
    let sku = build_zy_sku(brand, volume_ml, pkg_code, seq);
    while (used.has(sku)) {
      seq += 1;
      sku = build_zy_sku(brand, volume_ml, pkg_code, seq);
    }
    counters.set(prefix, seq);
    used.add(sku);
    card.proposed_sku = sku;
  }
}

async function main() {
  const decisions_path = path.join(ROOT, "review-decisions.json");
  const candidates_path = path.join(ROOT, "candidates.json");
  const manifest_path = path.join(ROOT, "manifest.json");
  const gallery_data_path = path.join(ROOT, "gallery-data.json");
  const gallery_html_path = path.join(ROOT, "gallery.html");
  const summary_path = path.join(ROOT, "collection-summary.json");
  const images_review_xlsx = path.join(ROOT, "images-review.xlsx");
  const second_pass_xlsx = path.join(ROOT, "second-pass-approved-new.xlsx");
  const second_pass_report = path.join(ROOT, "second-pass-report.json");

  const decisions = load_json<{
    generated_at: string;
    note?: string;
    counts: Record<string, number>;
    items: Array<Record<string, unknown>>;
  }>(decisions_path);
  const candidates = load_json<{
    candidates: Array<Record<string, unknown>>;
    [k: string]: unknown;
  }>(candidates_path);
  const manifest = load_json<{
    items: Array<Record<string, unknown>>;
    [k: string]: unknown;
  }>(manifest_path);
  const gallery = load_json<{
    cards: Array<Record<string, unknown>>;
    stats?: Record<string, unknown>;
    [k: string]: unknown;
  }>(gallery_data_path);

  const before_counts = { ...decisions.counts };
  const needs_review_before = decisions.items.filter(
    (i) => i.review_status === "needs_review",
  );
  const imported_skus = load_imported_skus();

  const cand_by_url = new Map(
    candidates.candidates.map((c) => [String(c.source_product_url), c]),
  );
  const man_by_url = new Map(
    manifest.items.map((m) => [String(m.source_product_url), m]),
  );
  const card_by_url = new Map(
    gallery.cards.map((c) => [String(c.source_product_url), c]),
  );

  let carton_detected = 0;
  let improved_images = 0;
  let package_resolved = 0;
  const second_pass_rows: Array<Record<string, unknown>> = [];
  const package_sources: Record<string, number> = {};

  console.error(
    `[second-pass] needs_review=${needs_review_before.length} imported_skus=${imported_skus.size}`,
  );

  for (let i = 0; i < needs_review_before.length; i += 1) {
    const decision = needs_review_before[i]!;
    const url = String(decision.source_product_url || "");
    const cand = cand_by_url.get(url);
    const man = man_by_url.get(url);
    const card = card_by_url.get(url);
    if (!cand || !card) {
      console.error(`[second-pass] skip missing join ${url}`);
      continue;
    }

    const pid =
      String(cand.source_product_id || "") ||
      product_id_from_url(url) ||
      "";
    let detail: ApiDetail | null = null;
    if (pid) {
      detail = await fetch_product_detail(pid);
      await sleep(DETAIL_DELAY_MS);
    }

    const parsed = parse_zy_product_name(String(cand.source_name || ""));
    const product_type =
      String(cand.product_type || "") ||
      detect_juice_product_type(String(cand.source_name || ""));
    // Do not change product_type without name confirmation
    const confirmed_type = detect_juice_product_type(
      String(cand.source_name || ""),
    );
    const final_product_type =
      confirmed_type !== "unknown" ? confirmed_type : product_type;

    const inference = infer_juice_package({
      source_name: String(cand.source_name || ""),
      brand: String(cand.brand || parsed.brand || ""),
      volume_ml:
        typeof cand.volume_ml === "number"
          ? cand.volume_ml
          : parsed.volume_ml,
      product_type: final_product_type,
      description: detail?.description || "",
      attributes_text: detail?.attributes_text || "",
    });
    package_sources[inference.source] =
      (package_sources[inference.source] || 0) + 1;

    const prev_pkg = normalize_package(String(cand.package_type || ""));
    if (inference.package_type !== "unknown") {
      package_resolved += 1;
      if (inference.package_type === "carton") carton_detected += 1;
      const pkg = package_display(inference.package_type);
      cand.package_type = pkg;
      cand.source_package = pkg;
      cand.package_code = inference.package_code;
      if (man) {
        man.package_type = pkg;
      }
      card.package_type = pkg;
      decision.second_pass_package = {
        package_type: inference.package_type,
        package_code: inference.package_code,
        confidence: inference.confidence,
        source: inference.source,
        evidence: inference.evidence,
        previous: prev_pkg || null,
      };
    }

    if (final_product_type && final_product_type !== "unknown") {
      cand.product_type = final_product_type;
      card.product_type = final_product_type;
    }

    // Image re-check for small / broken
    const width = Number(decision.width || man?.width || card.width || 0);
    const height = Number(decision.height || man?.height || card.height || 0);
    const download_status = String(
      man?.download_status || card.download_status || "",
    );
    const needs_image =
      width < MIN_SIDE ||
      height < MIN_SIDE ||
      download_status === "error" ||
      !String(decision.local_original_path || "").trim();

    if (needs_image) {
      const candidates_urls = [
        ...image_url_variants(String(decision.candidate_image_url || "")),
        ...(detail?.images || []).flatMap((u) => image_url_variants(u)),
        ...image_url_variants(String(cand.candidate_image_url || "")),
      ];
      let best: {
        url: string;
        buf: Buffer;
        width: number;
        height: number;
      } | null = null;
      for (const img_url of [...new Set(candidates_urls)]) {
        const buf = await fetch_bytes(img_url);
        if (!buf) continue;
        try {
          const meta = await sharp(buf, { failOn: "error" }).metadata();
          const w = meta.width || 0;
          const h = meta.height || 0;
          if (!best || w * h > best.width * best.height) {
            best = { url: img_url, buf, width: w, height: h };
          }
        } catch {
          /* ignore */
        }
        await sleep(80);
      }
      if (best && best.width >= MIN_SIDE && best.height >= MIN_SIDE) {
        const base = path.basename(
          String(
            man?.local_original_path ||
              decision.local_original_path ||
              `${String(decision.source_index || i).padStart(2, "0")}.webp`,
          ),
        );
        const original_abs = path.join(ROOT, "original", base);
        const preview_abs = path.join(
          ROOT,
          "previews",
          base.replace(/(\.[^.]+)?$/, ".preview.webp"),
        );
        mkdirSync(path.dirname(original_abs), { recursive: true });
        mkdirSync(path.dirname(preview_abs), { recursive: true });
        writeFileSync(original_abs, best.buf);
        const preview = await sharp(best.buf, { failOn: "error" })
          .rotate()
          .resize({
            width: 480,
            height: 480,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 72 })
          .toBuffer();
        writeFileSync(preview_abs, preview);
        const digest = sha256(best.buf);
        decision.candidate_image_url = best.url;
        decision.local_original_path = original_abs;
        decision.preview_path = `previews/${path.basename(preview_abs)}`;
        decision.width = best.width;
        decision.height = best.height;
        decision.sha256 = digest;
        cand.candidate_image_url = best.url;
        if (man) {
          man.candidate_image_url = best.url;
          man.local_original_path = original_abs;
          man.local_preview_path = preview_abs;
          man.width = best.width;
          man.height = best.height;
          man.file_size = best.buf.length;
          man.sha256 = digest;
          man.download_status = "ok";
          man.error_message = "";
          man.mime_type = "image/webp";
        }
        card.candidate_image_url = best.url;
        card.local_original_path = original_abs;
        card.preview_path = `previews/${path.basename(preview_abs)}`;
        card.original_path = `original/${base}`;
        card.width = best.width;
        card.height = best.height;
        card.sha256 = digest;
        card.below_500 = false;
        card.download_status = "ok";
        improved_images += 1;
        decision.second_pass_image = {
          improved: true,
          url: best.url,
          width: best.width,
          height: best.height,
        };
      } else {
        decision.second_pass_image = {
          improved: false,
          reason: best
            ? `best_still_small_${best.width}x${best.height}`
            : "no_valid_alternate_image",
        };
      }
    }

    if ((i + 1) % 25 === 0 || i === needs_review_before.length - 1) {
      console.error(
        `[second-pass] ${i + 1}/${needs_review_before.length} carton=${carton_detected} images_improved=${improved_images}`,
      );
    }
  }

  // Rebuild SKUs later (after gallery rebuild) with imported SKUs reserved.

  // Persist candidate/manifest updates first
  writeFileSync(candidates_path, JSON.stringify(candidates, null, 2) + "\n");
  writeFileSync(
    path.join(ROOT, "candidates.flat.json"),
    JSON.stringify(candidates.candidates, null, 2) + "\n",
  );
  writeFileSync(manifest_path, JSON.stringify(manifest, null, 2) + "\n");

  // Preserve previous approved/rejected, only re-decide needs_review via auto-review on full gallery
  const prev_by_url = new Map(
    decisions.items.map((d) => [String(d.source_product_url), d]),
  );

  const { spawnSync } = await import("node:child_process");

  // Rebuild gallery from updated manifest/candidates
  const bg = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/zelenoe-yabloko/build-gallery.ts",
      "--out-dir",
      ROOT,
      "--candidates",
      candidates_path,
      "--review",
      images_review_xlsx,
      "--products",
      "data/imports/tinda_active_products.snapshot.json",
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );
  if (bg.status !== 0) {
    console.error("[second-pass] build-gallery failed", bg.stderr || bg.stdout);
    throw new Error(`build-gallery failed status=${bg.status}`);
  }
  console.error(bg.stdout || "[second-pass] gallery rebuilt");

  // Reload gallery and reserve imported SKUs
  const gallery2 = load_json<{
    cards: Array<Record<string, unknown>>;
    stats?: Record<string, unknown>;
    [k: string]: unknown;
  }>(gallery_data_path);
  rebuild_skus(
    gallery2.cards as Array<{
      brand: string;
      volume_text: string;
      package_type: string;
      proposed_sku: string;
      source_name: string;
    }>,
    imported_skus,
  );
  // Re-apply second-pass package/product_type onto rebuilt cards
  for (const card of gallery2.cards) {
    const url = String(card.source_product_url || "");
    const cand = cand_by_url.get(url);
    const prev = prev_by_url.get(url);
    if (cand?.package_type) card.package_type = cand.package_type;
    if (cand?.product_type) card.product_type = cand.product_type;
    if (prev?.second_pass_image && (prev.second_pass_image as { improved?: boolean }).improved) {
      card.candidate_image_url = prev.candidate_image_url;
      card.local_original_path = prev.local_original_path;
      card.preview_path = prev.preview_path;
      card.width = prev.width;
      card.height = prev.height;
      card.sha256 = prev.sha256;
      card.below_500 = false;
      card.download_status = "ok";
    }
  }
  writeFileSync(gallery_data_path, JSON.stringify(gallery2, null, 2) + "\n");

  const ar = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/zelenoe-yabloko/auto-review.ts",
      "--root",
      ROOT,
      "--products",
      "data/imports/tinda_active_products.snapshot.json",
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );
  if (ar.status !== 0) {
    console.error(ar.stdout);
    console.error(ar.stderr);
    throw new Error(`auto-review failed status=${ar.status}`);
  }
  console.error(ar.stdout);

  const refreshed = load_json<{
    counts: Record<string, number>;
    items: Array<Record<string, unknown>>;
    note?: string;
  }>(decisions_path);

  const card_by_url2 = new Map(
    gallery2.cards.map((c) => [String(c.source_product_url), c]),
  );

  // Merge: do not restore rejected unless image improved; keep second_pass metadata
  const merged_items = refreshed.items.map((neu) => {
    const url = String(neu.source_product_url || "");
    const prev = prev_by_url.get(url);
    if (!prev) return neu;
    const prev_status = String(prev.review_status || "");
    const neu_status = String(neu.review_status || "");
    const image_improved =
      (prev.second_pass_image as { improved?: boolean } | undefined)
        ?.improved === true;

    let review_status = neu_status;
    let review_comment = String(neu.review_comment || "");
    let decision_reason = String(neu.decision_reason || "");

    if (prev_status === "rejected" && !image_improved) {
      review_status = "rejected";
      review_comment = String(prev.review_comment || review_comment);
      decision_reason = String(prev.decision_reason || "rejected_kept");
    }
    // Never demote previously approved_new (already imported or ready)
    if (
      prev_status === "approved_new" &&
      neu_status !== "approved_new" &&
      imported_skus.has(String((prev as { proposed_sku?: string }).proposed_sku || ""))
    ) {
      review_status = "approved_new";
      review_comment = String(prev.review_comment || review_comment);
      decision_reason = String(prev.decision_reason || decision_reason);
    }

    return {
      ...neu,
      review_status,
      review_comment,
      decision_reason,
      second_pass_package: prev.second_pass_package,
      second_pass_image: prev.second_pass_image,
      proposed_sku:
        card_by_url2.get(url)?.proposed_sku ||
        neu.proposed_sku ||
        (prev as { proposed_sku?: string }).proposed_sku,
    };
  });

  // Recount
  const counts = {
    approved_existing: merged_items.filter(
      (i) => i.review_status === "approved_existing",
    ).length,
    approved_new: merged_items.filter((i) => i.review_status === "approved_new")
      .length,
    needs_review: merged_items.filter((i) => i.review_status === "needs_review")
      .length,
    rejected: merged_items.filter((i) => i.review_status === "rejected").length,
  };

  const out_decisions = {
    generated_at: new Date().toISOString(),
    note:
      "Second-pass local re-review of needs_review (package + images). Production not modified.",
    counts,
    second_pass: {
      needs_review_before: needs_review_before.length,
      carton_detected,
      package_resolved,
      improved_images,
      package_sources,
      imported_skus_excluded: [...imported_skus],
    },
    approved_existing_skus: merged_items
      .filter((i) => i.review_status === "approved_existing")
      .map((i) => i.tinda_sku)
      .filter(Boolean),
    needs_review_brief: merged_items
      .filter((i) => i.review_status === "needs_review")
      .slice(0, 40)
      .map((i) => ({
        source_name: i.source_name,
        reason: i.decision_reason,
        mismatches: i.mismatches,
      })),
    items: merged_items,
  };
  writeFileSync(decisions_path, JSON.stringify(out_decisions, null, 2) + "\n");

  // Sync gallery card review fields
  for (const card of gallery2.cards) {
    const d = merged_items.find(
      (x) => String(x.source_product_url) === String(card.source_product_url),
    );
    if (!d) continue;
    card.review_status = d.review_status;
    card.review_comment = d.review_comment;
    card.proposed_sku =
      card.proposed_sku ||
      (d as { proposed_sku?: string }).proposed_sku ||
      "";
  }
  gallery2.stats = {
    ...(gallery2.stats || {}),
    auto_review: counts,
    second_pass: out_decisions.second_pass,
  };
  writeFileSync(gallery_data_path, JSON.stringify(gallery2, null, 2) + "\n");

  // Patch gallery.html with second-pass note (gallery.html already rebuilt earlier)
  if (existsSync(gallery_html_path)) {
    let html = readFileSync(gallery_html_path, "utf8");
    html = html.replace(
      /<!-- SECOND_PASS_NOTE -->[\s\S]*?<!-- \/SECOND_PASS_NOTE -->/,
      "",
    );
    html = html.replace(
      "</body>",
      `<!-- SECOND_PASS_NOTE --><script>window.__SECOND_PASS__=${JSON.stringify(
        out_decisions.second_pass,
      )};</script><!-- /SECOND_PASS_NOTE -->\n</body>`,
    );
    writeFileSync(gallery_html_path, html);
  }

  // Re-write review-decisions.xlsx
  const wb_dec = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb_dec,
    XLSX.utils.json_to_sheet(
      merged_items.map((i) => ({
        source_index: i.source_index,
        source_name: i.source_name,
        source_product_url: i.source_product_url,
        review_status: i.review_status,
        decision_reason: i.decision_reason,
        review_comment: i.review_comment,
        proposed_sku: (i as { proposed_sku?: string }).proposed_sku || "",
        width: i.width,
        height: i.height,
        match_status: i.match_status,
        mismatches: Array.isArray(i.mismatches)
          ? (i.mismatches as string[]).join("|")
          : "",
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
  XLSX.writeFile(wb_dec, path.join(ROOT, "review-decisions.xlsx"));

  // images-review.xlsx update (summary + decisions)
  const wb_img = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb_img,
    XLSX.utils.json_to_sheet([
      {
        needs_review_before: needs_review_before.length,
        approved_new: counts.approved_new,
        needs_review: counts.needs_review,
        rejected: counts.rejected,
        carton_detected,
        improved_images,
        package_resolved,
      },
    ]),
    "second_pass_summary",
  );
  XLSX.utils.book_append_sheet(
    wb_img,
    XLSX.utils.json_to_sheet(
      gallery2.cards.map((c) => ({
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
  XLSX.writeFile(wb_img, images_review_xlsx);
  writeFileSync(
    path.join(ROOT, "images-review.report.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        out_xlsx: images_review_xlsx,
        note: "Updated by juice second-pass (local only).",
        counts,
        second_pass: out_decisions.second_pass,
      },
      null,
      2,
    ) + "\n",
  );

  // New approved_new not yet imported
  const newly_approved = merged_items.filter((i) => {
    if (i.review_status !== "approved_new") return false;
    const sku = String((i as { proposed_sku?: string }).proposed_sku || "");
    if (!sku) return false;
    if (imported_skus.has(sku)) return false;
    // also exclude by source_url of already imported batch items
    return true;
  });

  // Exclude the original 50 imported products by source URL as well
  const imported_urls = new Set<string>();
  for (const rel of [
    "approved-new-import-batch.json",
    "missing-categories-import-batch.json",
  ]) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) continue;
    const batch = load_json<{ items?: Array<{ source_product_url?: string }> }>(
      p,
    );
    for (const it of batch.items || []) {
      if (it.source_product_url) imported_urls.add(it.source_product_url);
    }
  }
  const second_batch = newly_approved.filter(
    (i) => !imported_urls.has(String(i.source_product_url || "")),
  );

  for (const i of second_batch) {
    const url = String(i.source_product_url || "");
    const card = card_by_url2.get(url);
    const cand = cand_by_url.get(url);
    second_pass_rows.push({
      proposed_sku: card?.proposed_sku || (i as { proposed_sku?: string }).proposed_sku,
      source_name: i.source_name,
      brand: card?.brand || cand?.brand || "",
      flavor: card?.flavor || cand?.flavor || "",
      volume_text: card?.volume_text || cand?.volume_text || "",
      volume_ml: cand?.volume_ml ?? null,
      package_type: card?.package_type || cand?.package_type || "",
      package_code: cand?.package_code || "",
      product_type: card?.product_type || cand?.product_type || "",
      category_slug_hint:
        card?.product_type === "juice"
          ? "sok"
          : card?.product_type === "nectar"
            ? "nektar"
            : card?.product_type === "mors"
              ? "mors"
              : card?.product_type === "juice_drink"
                ? String(card.is_kids_line ? "detskie-soki" : "sokosoderzhashchie-napitki")
                : "",
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
      image_improved: i.second_pass_image
        ? JSON.stringify(i.second_pass_image)
        : "",
      sales_status: "showcase",
      price_amount: null,
      units_per_package: 1,
      package_requires_review: true,
    });
  }

  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb2,
    XLSX.utils.json_to_sheet(second_pass_rows),
    "approved_new",
  );
  XLSX.utils.book_append_sheet(
    wb2,
    XLSX.utils.json_to_sheet([
      {
        note: "Only new approved_new not yet imported. Imported 50 SKUs excluded.",
        rows: second_pass_rows.length,
        imported_skus: imported_skus.size,
      },
    ]),
    "meta",
  );
  XLSX.writeFile(wb2, second_pass_xlsx);

  // collection-summary update
  const summary = load_json<Record<string, unknown>>(summary_path);
  const unknown_package = candidates.candidates.filter(
    (c) => !normalize_package(String(c.package_type || "")),
  ).length;
  const below500 = manifest.items.filter(
    (m) => Number(m.width || 0) < MIN_SIDE || Number(m.height || 0) < MIN_SIDE,
  ).length;
  summary.generated_at = new Date().toISOString();
  summary.note =
    "LOCAL second-pass complete. No production / VPS / DB / image_url / price / seed changes. Nothing imported in this step.";
  summary.auto_review = counts;
  summary.unknown_package = unknown_package;
  summary.images_below_500 = below500;
  summary.second_pass = {
    ...out_decisions.second_pass,
    needs_review_after: counts.needs_review,
    approved_new_after: counts.approved_new,
    rejected_after: counts.rejected,
    second_pass_approved_new_ready: second_pass_rows.length,
    second_pass_xlsx,
  };
  summary.artifacts = {
    ...(summary.artifacts as object),
    second_pass_xlsx,
    second_pass_report,
  };
  writeFileSync(summary_path, JSON.stringify(summary, null, 2) + "\n");

  const probable_dupes = merged_items.filter(
    (i) =>
      i.review_status === "needs_review" &&
      (String(i.decision_reason || "").includes("probable") ||
        String(i.match_status || "") === "probable_match" ||
        (Array.isArray(i.mismatches) &&
          (i.mismatches as string[]).some((m) => /dup|probable/i.test(m)))),
  ).length;

  const report = {
    generated_at: new Date().toISOString(),
    production_changed: false,
    needs_review_before: needs_review_before.length,
    carton_detected,
    package_resolved,
    improved_images,
    package_sources,
    approved_new_after: counts.approved_new,
    needs_review_after: counts.needs_review,
    rejected_after: counts.rejected,
    probable_dupes,
    second_pass_batch_ready: second_pass_rows.length,
    imported_skus_excluded_count: imported_skus.size,
    imported_skus_in_second_batch: second_pass_rows.filter((r) =>
      imported_skus.has(String(r.proposed_sku || "")),
    ).length,
    paths: {
      review_decisions: decisions_path,
      images_review_xlsx,
      gallery_html: gallery_html_path,
      collection_summary: summary_path,
      second_pass_xlsx,
      second_pass_report,
    },
    before_counts,
    after_counts: counts,
  };
  writeFileSync(second_pass_report, JSON.stringify(report, null, 2) + "\n");

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
