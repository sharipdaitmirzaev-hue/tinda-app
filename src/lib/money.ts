import { Decimal } from "@prisma/client/runtime/library";

export type MoneyInput = Decimal | string | number;

export function to_decimal(value: MoneyInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Normalize money to 2 decimal places (banker's rounding via Decimal). */
export function money_round(value: MoneyInput): Decimal {
  return to_decimal(value).toDecimalPlaces(2);
}

export function money_to_number(value: MoneyInput): number {
  return money_round(value).toNumber();
}

export function calc_line_total(unit_price: MoneyInput, qty: number): Decimal {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new Error("qty must be a non-negative integer");
  }
  return money_round(to_decimal(unit_price).mul(qty));
}

export function sum_money(values: MoneyInput[]): Decimal {
  return money_round(
    values.reduce<Decimal>((acc, value) => acc.add(to_decimal(value)), new Decimal(0)),
  );
}

export function assert_non_negative_price(amount: MoneyInput, label = "Цена") {
  const value = to_decimal(amount);
  if (value.isNeg()) {
    throw new Error(`${label} не может быть отрицательной`);
  }
}

/** Money fields that must never go below zero (prices and order totals). */
export function assert_non_negative_money(amount: MoneyInput, label: string) {
  assert_non_negative_price(amount, label);
}

/** When a price is set, it must be strictly greater than zero (never use 0 as "no price"). */
export function assert_positive_price_if_set(
  amount: MoneyInput,
  label = "Цена",
) {
  const value = to_decimal(amount);
  if (value.lte(0)) {
    throw new Error(`${label} должна быть больше нуля`);
  }
}

/** @deprecated Use assert_positive_price_if_set — active products may have null price (showcase). */
export function assert_positive_price_for_active(
  amount: MoneyInput,
  label = "Цена",
) {
  assert_positive_price_if_set(amount, label);
}
