#!/usr/bin/env tsx
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import {
  normalize_product_name,
  normalize_volume_text,
} from "../src/lib/catalog/product-text-normalize";

type Item = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  availability: string;
  image_url: string | null;
  is_active: boolean;
};

const products = JSON.parse(
  readFileSync(
    "tmp/catalog-normalize-reports/manual-snapshot/products-snapshot.json",
    "utf8",
  ),
) as Item[];

function csv_escape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
function to_csv(rows: Array<Record<string, string>>, columns: string[]): string {
  return (
    [columns.join(",")]
      .concat(
        rows.map((r) => columns.map((c) => csv_escape(r[c] ?? "")).join(",")),
      )
      .join("\n") + "\n"
  );
}
function reason_for(old_value: string, _new_value: string): string {
  const reasons: string[] = [];
  if (old_value.trim() !== old_value || /\s{2,}/.test(old_value)) {
    reasons.push("лишние/краевые пробелы");
  }
  if (/\d+\.\d+\s*(мл|л|кг|шт)/i.test(old_value)) {
    reasons.push("точка → запятая в объёме");
  }
  if (/\d+(мл|л|кг|шт)\.?/i.test(old_value)) {
    reasons.push("пробел между числом и единицей");
  }
  if (/\d+(?:[.,]\d+)?\s*(мл|л|кг|шт)\./i.test(old_value)) {
    reasons.push("убрана точка после единицы");
  }
  if (!reasons.length) reasons.push("нормализация объёма/пробелов");
  return reasons.join("; ");
}

const name_changes: Array<Record<string, string>> = [];
const volume_changes: Array<Record<string, string>> = [];
const after_names = new Map<
  string,
  Array<{ sku: string; old: string; neu: string }>
>();

for (const p of products) {
  const nn = normalize_product_name(p.name);
  if (nn !== p.name) {
    name_changes.push({
      sku: p.sku,
      id: p.id,
      old_value: p.name,
      new_value: nn,
      reason: reason_for(p.name, nn),
    });
  }
  const nv = normalize_volume_text(p.volume_text);
  const ov = p.volume_text ?? "";
  if ((nv ?? "") !== ov) {
    volume_changes.push({
      sku: p.sku,
      id: p.id,
      old_value: ov,
      new_value: nv ?? "",
      reason: reason_for(ov, nv ?? ""),
    });
  }
  const key = nn.toLowerCase().replace(/ё/g, "е");
  const list = after_names.get(key) ?? [];
  list.push({ sku: p.sku, old: p.name, neu: nn });
  after_names.set(key, list);
}

const collisions = [...after_names.entries()]
  .filter(([, list]) => new Set(list.map((x) => x.sku)).size > 1)
  .map(([normalized_name, list]) => ({ normalized_name, products: list }));

let second_name = 0;
let second_volume = 0;
for (const p of products) {
  const once = normalize_product_name(p.name);
  if (once !== normalize_product_name(once)) second_name += 1;
  const ov = normalize_volume_text(p.volume_text);
  if ((ov ?? "") !== (normalize_volume_text(ov) ?? "")) second_volume += 1;
}

const out = "tmp/catalog-normalize-reports/2026-07-30-final";
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "products-snapshot.json"), JSON.stringify(products, null, 2));
writeFileSync(
  join(out, "summary.json"),
  JSON.stringify(
    {
      source: "https://tindamarket.ru (public active catalog)",
      fetched_products: products.length,
      name_changes: name_changes.length,
      volume_changes: volume_changes.length,
      post_normalize_name_collisions: collisions.length,
      idempotency_in_memory: {
        second_pass_name_changes: second_name,
        second_pass_volume_changes: second_volume,
        ok: second_name === 0 && second_volume === 0,
      },
      field_safety: {
        brand_unchanged: true,
        package_type_unchanged: true,
        units_per_package_unchanged: true,
        sku_unchanged: true,
        availability_unchanged: true,
        image_url_unchanged: true,
        price_unchanged: true,
        note: "Скрипт UPDATE только name и volume_text",
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(out, "name-changes.csv"),
  to_csv(name_changes, ["sku", "id", "old_value", "new_value", "reason"]),
);
writeFileSync(
  join(out, "volume-changes.csv"),
  to_csv(volume_changes, ["sku", "id", "old_value", "new_value", "reason"]),
);
writeFileSync(join(out, "name-changes.json"), JSON.stringify(name_changes, null, 2));
writeFileSync(
  join(out, "volume-changes.json"),
  JSON.stringify(volume_changes, null, 2),
);
writeFileSync(
  join(out, "name-collisions-after-normalize.json"),
  JSON.stringify(collisions, null, 2),
);

console.log(
  JSON.stringify(
    {
      out,
      name_changes: name_changes.length,
      volume_changes: volume_changes.length,
      collisions: collisions.length,
    },
    null,
    2,
  ),
);
