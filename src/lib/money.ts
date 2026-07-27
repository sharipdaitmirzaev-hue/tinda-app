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
