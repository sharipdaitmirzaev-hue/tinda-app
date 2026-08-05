#!/usr/bin/env tsx
/**
 * IRIB (ООО «ИРИБ») catalog importer for TINDA Market.
 *
 * Commands:
 *   discover / stage1 / dry-run — official site discover + artifacts (no DB writes)
 *   apply — gated create-only; requires confirmation + backup + manifest
 *
 * Does NOT touch Bavaria, Daryal, or AquAlania. Never uses --merge. Never edits existing products.
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
} from "fs";
import path from "path";
import {
  assert_apply_flags,
  should_skip_existing,
  validate_backup_file,
} from "../src/lib/imports/irib/apply-guards";
import { build_irib_sku } from "../src/lib/imports/irib/sku";
import { upload_product_image } from "../src/lib/storage/product-images";

const ROOT = process.cwd();
const ARTIFACTS_ROOT = path.join(ROOT, "artifacts", "irib-import");

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensure_dir(p: string) {
  mkdirSync(p, { recursive: true });
}

function arg_value(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${flag}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  return undefined;
}

function resolve_latest_stage1(): string | null {
  const latest = path.join(ARTIFACTS_ROOT, "latest-stage1");
  if (existsSync(latest)) {
    try {
      return realpathSync(latest);
    } catch {
      return latest;
    }
  }
  if (!existsSync(ARTIFACTS_ROOT)) return null;
  const dirs = readdirSync(ARTIFACTS_ROOT)
    .filter((n) => n.includes("stage1"))
    .map((n) => path.join(ARTIFACTS_ROOT, n))
    .filter((p) => lstatSync(p).isDirectory())
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function run_stage1(): number {
  const script = path.join(ROOT, "scripts", "irib-stage1.py");
  const res = spawnSync("python3", [script], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return res.status ?? 1;
}

type ApprovedRow = Record<string, string>;

function parse_csv_rows(text: string): ApprovedRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: ApprovedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols: string[] = [];
    let cur = "";
    let inq = false;
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        if (inq && line[c + 1] === '"') {
          cur += '"';
          c++;
        } else inq = !inq;
        continue;
      }
      if (ch === "," && !inq) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? "").trim();
    });
    if (!obj.proposed_sku) continue;
    rows.push(obj);
  }
  return rows;
}

type Manifest = {
  approved_skus?: string[];
  manual_skus?: string[];
  rejected_skus?: string[];
  apply?: {
    sales_status?: string;
    is_active?: boolean;
    availability?: string;
    price_amount?: null;
    orderable?: boolean;
    units_per_package?: number;
    create_only?: boolean;
    modify_existing_products?: boolean;
  };
  brand?: string;
  manufacturer?: string;
  source_primary?: string;
};

function cmd_discover_or_dry_run(mode: string) {
  console.log(`IRIB ${mode}: running official-site stage1 (no DB writes)...`);
  const code = run_stage1();
  if (code !== 0) {
    process.exitCode = code;
    return;
  }
  const latest = resolve_latest_stage1();
  if (!latest) {
    console.error("Stage1 finished but artifacts/irib-import/latest-stage1 missing");
    process.exitCode = 1;
    return;
  }
  const manifest_path = path.join(latest, "approved-import-manifest.json");
  const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as Manifest;
  console.log(
    JSON.stringify(
      {
        mode,
        artifacts: latest,
        discovered:
          (manifest.approved_skus?.length || 0) +
          (manifest.manual_skus?.length || 0) +
          (manifest.rejected_skus?.length || 0),
        approved: manifest.approved_skus?.length || 0,
        manual: manifest.manual_skus?.length || 0,
        rejected: manifest.rejected_skus?.length || 0,
        production_writes: false,
        apply_run: false,
      },
      null,
      2,
    ),
  );
}

function load_image_buffer(
  row: ApprovedRow,
  manifest_dir: string,
): { buffer: Buffer; filename: string } | null {
  const rel = row.image_path?.trim();
  if (rel) {
    const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (existsSync(abs)) {
      return { buffer: readFileSync(abs), filename: path.basename(abs) };
    }
    const local = path.join(manifest_dir, "processed", `${row.proposed_sku}.webp`);
    if (existsSync(local)) {
      return { buffer: readFileSync(local), filename: path.basename(local) };
    }
  }
  const processed = path.join(manifest_dir, "processed", `${row.proposed_sku}.webp`);
  if (existsSync(processed)) {
    return { buffer: readFileSync(processed), filename: path.basename(processed) };
  }
  return null;
}

async function cmd_apply() {
  const confirmed = process.argv.includes("--i-understand-and-have-backup");
  const backup_path = arg_value("--backup-path");
  const manifest_path = arg_value("--manifest");
  const merge = process.argv.includes("--merge");

  const flags = assert_apply_flags({ confirmed, backup_path, manifest_path, merge });
  if (!flags.ok) {
    console.error(flags.error);
    process.exitCode = 2;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("APPLY BLOCKED: DATABASE_URL is not set in this environment");
    process.exitCode = 2;
    return;
  }

  const backup = validate_backup_file(backup_path!);
  if (!backup.ok) {
    console.error(`APPLY BLOCKED: ${backup.error}`);
    process.exitCode = 2;
    return;
  }

  if (!existsSync(manifest_path!)) {
    console.error(`APPLY BLOCKED: manifest not found: ${manifest_path}`);
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(readFileSync(manifest_path!, "utf8")) as Manifest;
  if (!manifest.approved_skus?.length) {
    console.error("APPLY BLOCKED: manifest has no approved_skus");
    process.exitCode = 2;
    return;
  }
  if (manifest.apply?.modify_existing_products) {
    console.error("APPLY BLOCKED: manifest must not allow modifying existing products");
    process.exitCode = 2;
    return;
  }

  const manifest_dir = path.dirname(manifest_path!);
  const approved_csv_candidates = [
    path.join(manifest_dir, "approved-products-final.csv"),
    path.join(manifest_dir, "approved-products.csv"),
  ];
  const approved_csv = approved_csv_candidates.find((p) => existsSync(p));
  if (!approved_csv) {
    console.error(
      "APPLY BLOCKED: approved-products-final.csv (or approved-products.csv) missing next to manifest",
    );
    process.exitCode = 2;
    return;
  }

  const blocked = new Set(
    [
      "manual-review.csv",
      "manual-review-final.csv",
      "rejected-products.csv",
      "rejected-products-final.csv",
    ]
      .map((name) => path.join(manifest_dir, name))
      .filter((p) => existsSync(p))
      .flatMap((p) => parse_csv_rows(readFileSync(p, "utf8")).map((r) => r.proposed_sku)),
  );

  const approved_rows = parse_csv_rows(readFileSync(approved_csv, "utf8")).filter((r) =>
    manifest.approved_skus!.includes(r.proposed_sku),
  );
  if (!approved_rows.length) {
    console.error("APPLY BLOCKED: no approved rows matched manifest SKUs");
    process.exitCode = 2;
    return;
  }

  for (const row of approved_rows) {
    const sku = row.proposed_sku.trim();
    if (blocked.has(sku)) {
      console.error(`APPLY BLOCKED: SKU listed in manual/rejected: ${sku}`);
      process.exitCode = 2;
      return;
    }
    if (!row.proposed_name?.trim() || !row.brand?.trim() || !row.category_id?.trim()) {
      console.error(`APPLY BLOCKED: incomplete row ${sku}`);
      process.exitCode = 2;
      return;
    }
    if (row.review_status && row.review_status !== "approved") {
      console.error(`APPLY BLOCKED: non-approved review_status for ${sku}`);
      process.exitCode = 2;
      return;
    }
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const apply_out = path.join(ARTIFACTS_ROOT, `${stamp()}-apply`);
  ensure_dir(apply_out);

  type Fingerprint = {
    sku: string;
    name: string;
    brand: string | null;
    category_id: string;
    price_amount: unknown;
    availability: string;
    sales_status: string;
    image_url: string | null;
    updated_at: Date;
  };

  const result = {
    started_at: new Date().toISOString(),
    backup_path,
    backup_size: backup.backup_size,
    backup_sha256: backup.backup_sha256,
    manifest_path,
    approved_csv,
    approved_input_count: approved_rows.length,
    created: [] as string[],
    skipped_existing: [] as string[],
    images_uploaded: [] as string[],
    images_missing: [] as string[],
    errors: [] as Array<{ sku: string; error: string }>,
    existing_products_edited: false,
    existing_fingerprint_mismatches: [] as string[],
    category_distribution_created: {} as Record<string, number>,
    catalog_total_before: 0,
    catalog_total_after: null as number | null,
    create_only: true,
    merge_used: false,
  };

  try {
    const before = await prisma.products.findMany({
      select: {
        sku: true,
        name: true,
        brand: true,
        category_id: true,
        price_amount: true,
        availability: true,
        sales_status: true,
        image_url: true,
        updated_at: true,
      },
    });
    result.catalog_total_before = before.length;
    const before_map = new Map<string, Fingerprint>(before.map((p) => [p.sku, p]));

    const sales_status = manifest.apply?.sales_status || "showcase";
    const availability = manifest.apply?.availability || "on_order";
    const is_active = manifest.apply?.is_active ?? true;

    for (const row of approved_rows) {
      const sku = row.proposed_sku.trim();
      try {
        const existing = await prisma.products.findUnique({ where: { sku } });
        if (should_skip_existing(existing)) {
          result.skipped_existing.push(sku);
          continue;
        }

        const category_id = row.category_id.trim();
        const cat = await prisma.categories.findUnique({ where: { id: category_id } });
        if (!cat) {
          throw new Error(`category_id not found in DB: ${category_id}`);
        }

        const description = [
          `Производитель: ${row.manufacturer?.trim() || "ООО «ИРИБ»"}`,
          `Бренд: ${row.brand?.trim() || "Ириб"}`,
          row.flavor ? `Вкус: ${row.flavor}` : null,
          row.line ? `Линейка: ${row.line}` : null,
          row.source_url ? `Источник (сайт): ${row.source_url}` : null,
          "Импорт: IRIB official site irib.su (showcase, без цены, заказ недоступен)",
        ]
          .filter(Boolean)
          .join("\n");

        const created = await prisma.products.create({
          data: {
            sku,
            name: row.proposed_name.trim(),
            brand: row.brand?.trim() || "Ириб",
            category_id,
            volume_text: row.volume_text?.trim() || null,
            package_type: row.package_type?.trim() || null,
            units_per_package: Number(row.units_per_package || 1) || 1,
            sale_unit: "шт",
            min_order_qty: 1,
            allow_piece_sale: false,
            description,
            availability,
            sales_status,
            is_active,
            price_amount: null,
            price_currency: "RUB",
            image_url: null,
            is_promo: false,
            is_new: true,
            is_hit: false,
          },
        });

        const img = load_image_buffer(row, manifest_dir);
        if (img) {
          try {
            const stored = await upload_product_image({
              product_id: created.id,
              buffer: img.buffer,
              filename: img.filename,
            });
            await prisma.products.update({
              where: { id: created.id },
              data: { image_url: stored.image_url },
            });
            result.images_uploaded.push(sku);
          } catch (err) {
            result.images_missing.push(sku);
            result.errors.push({
              sku,
              error: `image upload failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          result.images_missing.push(sku);
        }

        result.created.push(sku);
        const cat_name = row.category || cat.name;
        result.category_distribution_created[cat_name] =
          (result.category_distribution_created[cat_name] || 0) + 1;
      } catch (err) {
        result.errors.push({
          sku,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const after_existing = await prisma.products.findMany({
      select: {
        sku: true,
        name: true,
        brand: true,
        category_id: true,
        price_amount: true,
        availability: true,
        sales_status: true,
        image_url: true,
        updated_at: true,
      },
      where: { sku: { in: [...before_map.keys()] } },
    });
    for (const p of after_existing) {
      const prev = before_map.get(p.sku);
      if (!prev) continue;
      const same =
        prev.name === p.name &&
        prev.brand === p.brand &&
        prev.category_id === p.category_id &&
        String(prev.price_amount) === String(p.price_amount) &&
        prev.availability === p.availability &&
        prev.sales_status === p.sales_status &&
        prev.image_url === p.image_url &&
        prev.updated_at.getTime() === p.updated_at.getTime();
      if (!same) {
        result.existing_products_edited = true;
        result.existing_fingerprint_mismatches.push(p.sku);
      }
    }

    result.catalog_total_after = await prisma.products.count();
  } finally {
    await prisma.$disconnect();
  }

  writeFileSync(path.join(apply_out, "APPLY-REPORT.json"), JSON.stringify(result, null, 2));
  const md = `# IRIB APPLY REPORT

- started: ${result.started_at}
- backup: \`${result.backup_path}\`
- backup sha256: \`${result.backup_sha256}\`
- created: **${result.created.length}**
- skipped existing: **${result.skipped_existing.length}**
- errors: **${result.errors.length}**
- images uploaded: **${result.images_uploaded.length}**
- existing products edited: **${result.existing_products_edited}**
- catalog: ${result.catalog_total_before} → ${result.catalog_total_after}
`;
  writeFileSync(path.join(apply_out, "APPLY-REPORT.md"), md, "utf8");
  console.log(md);

  if (result.existing_products_edited) process.exitCode = 5;
  if (result.errors.length) process.exitCode = 4;
}

async function main() {
  const cmd = process.argv[2] || "dry-run";
  if (cmd === "sku-demo") {
    console.log(
      build_irib_sku({
        line: "NEKTAR",
        flavor_key: "ABRIKOS",
        volume_ml: 750,
        package_code: "GLASS",
      }),
    );
    return;
  }
  if (cmd === "discover" || cmd === "stage1" || cmd === "dry-run") {
    cmd_discover_or_dry_run(cmd);
    return;
  }
  if (cmd === "apply") {
    await cmd_apply();
    return;
  }
  console.error(`Unknown command: ${cmd}. Use discover|dry-run|stage1|apply`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
