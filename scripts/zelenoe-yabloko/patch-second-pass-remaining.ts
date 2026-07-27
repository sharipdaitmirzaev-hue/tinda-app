#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  build_zy_sku,
  infer_juice_package,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";
import {
  normalize_package,
  parse_volume_ml,
} from "../../src/lib/catalog/external-images/normalize";

const ROOT = "data/imports/zelenoe-yabloko-juice";
const decisions = JSON.parse(readFileSync(`${ROOT}/review-decisions.json`, "utf8"));
const candidates = JSON.parse(readFileSync(`${ROOT}/candidates.json`, "utf8"));
const manifest = JSON.parse(readFileSync(`${ROOT}/manifest.json`, "utf8"));
const gallery = JSON.parse(readFileSync(`${ROOT}/gallery-data.json`, "utf8"));
const imported = new Set([
  ...JSON.parse(readFileSync(`${ROOT}/approved-apply-report.json`, "utf8"))
    .created_skus,
  ...JSON.parse(
    readFileSync(`${ROOT}/missing-categories-apply-report.json`, "utf8"),
  ).created_skus,
]);
const byUrlC = new Map(
  candidates.candidates.map((c) => [c.source_product_url, c]),
);
const byUrlM = new Map(manifest.items.map((m) => [m.source_product_url, m]));
const byUrlG = new Map(gallery.cards.map((c) => [c.source_product_url, c]));

let extraCarton = 0;
for (const d of decisions.items.filter((i) => i.review_status === "needs_review")) {
  const c = byUrlC.get(d.source_product_url);
  if (!c) continue;
  const inf = infer_juice_package({
    source_name: c.source_name,
    brand: c.brand,
    volume_ml: c.volume_ml,
    product_type: c.product_type,
  });
  if (inf.package_type === "unknown") continue;
  if (inf.package_type === "carton") extraCarton += 1;
  c.package_type = inf.package_type;
  c.source_package = inf.package_type;
  c.package_code = inf.package_code;
  const m = byUrlM.get(d.source_product_url);
  if (m) m.package_type = inf.package_type;
  const g = byUrlG.get(d.source_product_url);
  if (g) g.package_type = inf.package_type;
  d.second_pass_package = {
    ...(d.second_pass_package || {}),
    package_type: inf.package_type,
    package_code: inf.package_code,
    confidence: inf.confidence,
    source: inf.source,
    evidence: inf.evidence,
  };
}
console.log("extra carton resolved on remaining", extraCarton);

const used = new Set([...imported]);
const counters = new Map();
for (const card of gallery.cards) {
  const parsed = parse_zy_product_name(card.source_name);
  const brand = card.brand || parsed.brand;
  const volume_ml = parse_volume_ml(card.volume_text) ?? parsed.volume_ml;
  const code =
    normalize_package(card.package_type).toUpperCase() ||
    parsed.package_code ||
    "UNK";
  const pkg = [
    "CARTON",
    "PET",
    "GLASS",
    "CAN",
    "POUCH",
    "OTHER",
    "PACK",
  ].includes(code)
    ? code
    : parsed.package_code || "UNK";
  const prefix = `${brand}|${volume_ml}|${pkg}`;
  let seq = (counters.get(prefix) || 0) + 1;
  let sku = build_zy_sku(brand, volume_ml, pkg, seq);
  while (used.has(sku)) {
    seq += 1;
    sku = build_zy_sku(brand, volume_ml, pkg, seq);
  }
  counters.set(prefix, seq);
  used.add(sku);
  card.proposed_sku = sku;
}

writeFileSync(`${ROOT}/candidates.json`, JSON.stringify(candidates, null, 2) + "\n");
writeFileSync(
  `${ROOT}/candidates.flat.json`,
  JSON.stringify(candidates.candidates, null, 2) + "\n",
);
writeFileSync(`${ROOT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(`${ROOT}/gallery-data.json`, JSON.stringify(gallery, null, 2) + "\n");
writeFileSync(
  `${ROOT}/review-decisions.json`,
  JSON.stringify(decisions, null, 2) + "\n",
);

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
  { encoding: "utf8" },
);
process.stdout.write(ar.stdout || "");
process.stderr.write(ar.stderr || "");
if (ar.status !== 0) process.exit(ar.status || 1);
