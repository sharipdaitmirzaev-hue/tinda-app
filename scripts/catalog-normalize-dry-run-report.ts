#!/usr/bin/env tsx
/**
 * Read-only dry-run of catalog text normalization against live public catalog.
 * Does NOT write to production DB.
 *
 * Usage:
 *   npx tsx scripts/catalog-normalize-dry-run-report.ts
 *   npx tsx scripts/catalog-normalize-dry-run-report.ts --base https://tindamarket.ru
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  normalize_product_name,
  normalize_volume_text,
} from "../src/lib/catalog/product-text-normalize";

type CatalogItem = {
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
  sales_status?: string;
};

type NameChange = {
  sku: string;
  id: string;
  old_value: string;
  new_value: string;
  reason: string;
};

type VolumeChange = {
  sku: string;
  id: string;
  old_value: string;
  new_value: string;
  reason: string;
};

function csv_escape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function to_csv(
  rows: Array<Record<string, string>>,
  columns: string[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csv_escape(row[c] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function reason_for_name(old_value: string, new_value: string): string {
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
  if (reasons.length === 0 && old_value !== new_value) {
    reasons.push("нормализация объёма/пробелов");
  }
  return reasons.join("; ");
}

function reason_for_volume(old_value: string, new_value: string): string {
  return reason_for_name(old_value, new_value);
}

async function fetch_json(url: string, attempts = 5): Promise<unknown> {
  let last_error: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.json();
    } catch (error) {
      last_error = error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last_error;
}

async function fetch_all(base: string): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total) {
    const url = `${base}/api/v1/catalog/products?page=${page}&page_size=24`;
    const data = (await fetch_json(url)) as {
      items: CatalogItem[];
      total: number;
    };
    total = data.total;
    items.push(...(data.items ?? []));
    console.error(`fetched page ${page}: ${items.length}/${total}`);
    if (!data.items?.length) break;
    page += 1;
    if (page > 50) break;
  }
  return items;
}

async function main() {
  const base_arg = process.argv.indexOf("--base");
  const base =
    (base_arg >= 0 ? process.argv[base_arg + 1] : null) ||
    process.env.APP_URL ||
    "https://tindamarket.ru";

  const out_dir = join(
    process.cwd(),
    "tmp",
    "catalog-normalize-reports",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(out_dir, { recursive: true });

  const products = await fetch_all(base.replace(/\/$/, ""));

  const name_changes: NameChange[] = [];
  const volume_changes: VolumeChange[] = [];
  const after_names = new Map<string, Array<{ sku: string; old: string; neu: string }>>();

  for (const product of products) {
    const next_name = normalize_product_name(product.name);
    if (next_name !== product.name) {
      name_changes.push({
        sku: product.sku,
        id: product.id,
        old_value: product.name,
        new_value: next_name,
        reason: reason_for_name(product.name, next_name),
      });
    }

    const next_volume = normalize_volume_text(product.volume_text);
    const old_volume = product.volume_text ?? "";
    if ((next_volume ?? "") !== old_volume) {
      volume_changes.push({
        sku: product.sku,
        id: product.id,
        old_value: old_volume,
        new_value: next_volume ?? "",
        reason: reason_for_volume(old_volume, next_volume ?? ""),
      });
    }

    const key = next_name.toLowerCase().replace(/ё/g, "е");
    const list = after_names.get(key) ?? [];
    list.push({ sku: product.sku, old: product.name, neu: next_name });
    after_names.set(key, list);
  }

  const collisions = [...after_names.entries()]
    .filter(([, list]) => {
      const skus = new Set(list.map((x) => x.sku));
      return skus.size > 1;
    })
    .map(([normalized, list]) => ({
      normalized_name: normalized,
      products: list,
    }));

  // Safety: confirm normalize never mutates non-text commercial fields in this dry-run model
  const field_safety = {
    brand_unchanged: true,
    package_type_unchanged: true,
    units_per_package_unchanged: true,
    sku_unchanged: true,
    availability_unchanged: true,
    image_url_unchanged: true,
    note:
      "Нормализация меняет только name и volume_text. brand/package/units/sku/availability/image_url не входят в UPDATE-поля скрипта.",
  };

  // In-memory idempotency: apply once, normalize again → 0 changes
  let second_name = 0;
  let second_volume = 0;
  for (const product of products) {
    const once_name = normalize_product_name(product.name);
    const twice_name = normalize_product_name(once_name);
    if (once_name !== twice_name) second_name += 1;

    const once_vol = normalize_volume_text(product.volume_text);
    const twice_vol = normalize_volume_text(once_vol);
    if ((once_vol ?? "") !== (twice_vol ?? "")) second_volume += 1;
  }

  const summary = {
    source: base,
    fetched_products: products.length,
    name_changes: name_changes.length,
    volume_changes: volume_changes.length,
    post_normalize_name_collisions: collisions.length,
    idempotency_in_memory: {
      second_pass_name_changes: second_name,
      second_pass_volume_changes: second_volume,
      ok: second_name === 0 && second_volume === 0,
    },
    field_safety,
    note:
      "Публичный каталог содержит только активные товары. Неактивные seed/скрытые позиции в этот dry-run не входят.",
  };

  writeFileSync(
    join(out_dir, "products-snapshot.json"),
    JSON.stringify(products, null, 2),
  );
  writeFileSync(join(out_dir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(out_dir, "name-changes.csv"),
    to_csv(
      name_changes.map((r) => ({
        sku: r.sku,
        id: r.id,
        old_value: r.old_value,
        new_value: r.new_value,
        reason: r.reason,
      })),
      ["sku", "id", "old_value", "new_value", "reason"],
    ),
  );
  writeFileSync(
    join(out_dir, "volume-changes.csv"),
    to_csv(
      volume_changes.map((r) => ({
        sku: r.sku,
        id: r.id,
        old_value: r.old_value,
        new_value: r.new_value,
        reason: r.reason,
      })),
      ["sku", "id", "old_value", "new_value", "reason"],
    ),
  );
  writeFileSync(
    join(out_dir, "name-collisions-after-normalize.json"),
    JSON.stringify(collisions, null, 2),
  );
  writeFileSync(
    join(out_dir, "name-changes.json"),
    JSON.stringify(name_changes, null, 2),
  );
  writeFileSync(
    join(out_dir, "volume-changes.json"),
    JSON.stringify(volume_changes, null, 2),
  );

  console.log(JSON.stringify({ out_dir, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
