import { Decimal } from "@prisma/client/runtime/library";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { assert_catalog_editor, type AuthUserPayload } from "@/lib/access";
import { money_round, to_decimal } from "@/lib/money";

export type PriceImportRowResult = {
  row: number;
  sku: string | null;
  price_amount: string | null;
  ok: boolean;
  error: string | null;
};

function cell_to_string(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function parse_price_amount(raw: string): Decimal | null {
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  try {
    const value = to_decimal(normalized);
    if (!value.isFinite() || value.isNeg()) return null;
    return money_round(value);
  } catch {
    return null;
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
    const row_number = index + 2; // header is row 1
    const row = rows[index] ?? {};
    const sku = cell_to_string(row.sku ?? row.SKU ?? row.Sku);
    const price_raw = cell_to_string(
      row.price_amount ?? row.PRICE_AMOUNT ?? row.Price_amount ?? row.price,
    );

    if (!sku) {
      results.push({
        row: row_number,
        sku: null,
        price_amount: price_raw || null,
        ok: false,
        error: "Не указан sku",
      });
      continue;
    }

    const price = parse_price_amount(price_raw);
    if (price === null || price.lte(0)) {
      results.push({
        row: row_number,
        sku,
        price_amount: price_raw || null,
        ok: false,
        error: "Пустая или неправильная цена (price_amount должен быть > 0)",
      });
      continue;
    }

    const product = await prisma.products.findUnique({ where: { sku } });
    if (!product) {
      results.push({
        row: row_number,
        sku,
        price_amount: price.toString(),
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
      },
    });
    updated += 1;
    results.push({
      row: row_number,
      sku,
      price_amount: price.toString(),
      ok: true,
      error: null,
    });
  }

  return {
    updated,
    failed: results.filter((row) => !row.ok).length,
    results,
    message: `Обновлено цен: ${updated}`,
  };
}
