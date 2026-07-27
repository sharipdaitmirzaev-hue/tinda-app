import { Decimal } from "@prisma/client/runtime/library";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { assert_catalog_editor, type AuthUserPayload } from "@/lib/access";
import { money_round, to_decimal } from "@/lib/money";
import { SALES_STATUS_VALUES } from "@/lib/catalog/constants";

export type PriceImportRowResult = {
  row: number;
  sku: string | null;
  price_amount: string | null;
  sales_status: string | null;
  ok: boolean;
  error: string | null;
};

function cell_to_string(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function parse_price_amount(raw: string): Decimal | null | "invalid" {
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  try {
    const value = to_decimal(normalized);
    if (!value.isFinite() || value.isNeg()) return "invalid";
    if (value.lte(0)) return "invalid";
    return money_round(value);
  } catch {
    return "invalid";
  }
}

export async function import_product_prices_from_workbook(
  payload: AuthUserPayload,
  buffer: Buffer,
) {
  assert_catalog_editor(payload);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new AppError(400, "validation_error", "Не удалось прочитать Excel-файл");
  }

  const sheet_name = workbook.SheetNames[0];
  if (!sheet_name) {
    throw new AppError(400, "validation_error", "В файле нет листов");
  }

  const sheet = workbook.Sheets[sheet_name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (rows.length === 0) {
    throw new AppError(400, "validation_error", "Файл не содержит строк данных");
  }

  const results: PriceImportRowResult[] = [];
  let updated = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row_number = index + 2;
    const row = rows[index] ?? {};
    const sku = cell_to_string(row.sku ?? row.SKU ?? row.Sku);
    const price_raw = cell_to_string(
      row.price_amount ?? row.PRICE_AMOUNT ?? row.Price_amount ?? row.price,
    );
    const sales_raw = cell_to_string(
      row.sales_status ?? row.SALES_STATUS ?? row.Sales_status,
    ).toLowerCase();

    if (!sku) {
      results.push({
        row: row_number,
        sku: null,
        price_amount: price_raw || null,
        sales_status: sales_raw || null,
        ok: false,
        error: "Не указан sku",
      });
      continue;
    }

    // Never accept metro_price as TINDA price (only when a value is present)
    const metro_raw = cell_to_string(row.metro_price ?? row.METRO_PRICE);
    if (!price_raw && metro_raw) {
      results.push({
        row: row_number,
        sku,
        price_amount: null,
        sales_status: sales_raw || null,
        ok: false,
        error: "metro_price нельзя использовать как price_amount ТИНДА",
      });
      continue;
    }

    const price = parse_price_amount(price_raw);
    if (price === "invalid") {
      results.push({
        row: row_number,
        sku,
        price_amount: price_raw || null,
        sales_status: sales_raw || null,
        ok: false,
        error: "Некорректная цена (должна быть > 0 или пусто)",
      });
      continue;
    }

    const sales_status =
      sales_raw ||
      (price ? "orderable" : "showcase");
    if (
      sales_raw &&
      !(SALES_STATUS_VALUES as readonly string[]).includes(sales_raw)
    ) {
      results.push({
        row: row_number,
        sku,
        price_amount: price_raw || null,
        sales_status: sales_raw,
        ok: false,
        error: "Некорректный sales_status (showcase|on_request|orderable)",
      });
      continue;
    }

    if (sales_status === "orderable" && (price === null || price.lte(0))) {
      results.push({
        row: row_number,
        sku,
        price_amount: price_raw || null,
        sales_status,
        ok: false,
        error: "Для orderable нужна price_amount > 0",
      });
      continue;
    }

    const product = await prisma.products.findUnique({ where: { sku } });
    if (!product) {
      results.push({
        row: row_number,
        sku,
        price_amount: price ? price.toString() : null,
        sales_status,
        ok: false,
        error: "Товар с таким sku не найден",
      });
      continue;
    }

    await prisma.products.update({
      where: { id: product.id },
      data: {
        price_amount: price,
        price_currency: "RUB",
        sales_status,
      },
    });
    updated += 1;
    results.push({
      row: row_number,
      sku,
      price_amount: price ? price.toString() : null,
      sales_status,
      ok: true,
      error: null,
    });
  }

  return {
    updated,
    failed: results.filter((row) => !row.ok).length,
    results,
    message: `Обновлено строк: ${updated}`,
  };
}
