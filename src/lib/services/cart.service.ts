import type { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  assert_approved_client,
  type AuthUserPayload,
} from "@/lib/access";
import { can_add_to_cart, check_qty } from "@/lib/quantity";
import {
  calc_line_total,
  money_to_number,
  sum_money,
} from "@/lib/money";
import type {
  SerializedCart,
  SerializedCartItem,
  SerializedCartProduct,
} from "@/lib/cart/types";

export type {
  SerializedCart,
  SerializedCartItem,
  SerializedCartProduct,
} from "@/lib/cart/types";

type CartProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  sale_unit: string;
  min_order_qty: number;
  allow_piece_sale: boolean;
  availability: string;
  image_url: string | null;
  is_active: boolean;
  price_amount: Decimal | string | number;
  price_currency: string;
  category: { is_active: boolean } | null;
};

function serialize_product(product: CartProductRow): SerializedCartProduct {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    volume_text: product.volume_text,
    package_type: product.package_type,
    units_per_package: product.units_per_package,
    sale_unit: product.sale_unit,
    min_order_qty: product.min_order_qty,
    allow_piece_sale: product.allow_piece_sale,
    availability: product.availability,
    image_url: product.image_url,
    is_active: product.is_active,
    price: {
      amount: money_to_number(product.price_amount),
      currency: product.price_currency || "RUB",
      unit: product.sale_unit,
    },
  };
}

function evaluate_cart_item(
  product: CartProductRow,
  qty: number,
): Pick<SerializedCartItem, "qty_error" | "suggested_qty"> {
  const category_inactive = product.category?.is_active === false;
  const product_inactive = !product.is_active || category_inactive;

  if (product_inactive) {
    return { qty_error: "inactive", suggested_qty: null };
  }

  if (product.availability === "out_of_stock") {
    return { qty_error: "out_of_stock", suggested_qty: null };
  }

  const check = check_qty(
    {
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
      is_active: product.is_active,
    },
    qty,
  );

  if (check.valid) {
    return { qty_error: null, suggested_qty: null };
  }

  return {
    qty_error: check.qty_error,
    suggested_qty: check.suggested_qty,
  };
}

export function serialize_cart(
  items: Array<{ product_id: string; qty: number; product: CartProductRow }>,
): SerializedCart {
  const serialized_items: SerializedCartItem[] = items.map((item) => {
    const evaluated = evaluate_cart_item(item.product, item.qty);
    // Always price from DB product row — never from client input.
    const unit_price = money_to_number(item.product.price_amount);
    const line_total = money_to_number(
      calc_line_total(item.product.price_amount, item.qty),
    );
    const currency = item.product.price_currency || "RUB";

    return {
      product_id: item.product_id,
      qty: item.qty,
      product: serialize_product(item.product),
      qty_error: evaluated.qty_error,
      suggested_qty: evaluated.suggested_qty,
      unit_price,
      currency,
      line_total,
    };
  });

  const items_count = serialized_items.length;
  const total_qty = serialized_items.reduce((sum, item) => sum + item.qty, 0);
  const is_ready_to_checkout =
    items_count > 0 && serialized_items.every((item) => item.qty_error === null);

  const subtotal = money_to_number(
    sum_money(serialized_items.map((item) => item.line_total)),
  );
  const delivery_total = 0;
  const total = money_to_number(sum_money([subtotal, delivery_total]));

  return {
    items: serialized_items,
    items_count,
    total_qty,
    is_ready_to_checkout,
    subtotal,
    delivery_total,
    total,
  };
}

const cart_item_include = {
  product: {
    include: {
      category: { select: { is_active: true } },
    },
  },
} as const;

async function get_or_create_cart(client_id: string) {
  const existing = await prisma.carts.findUnique({
    where: { client_id },
  });
  if (existing) return existing;

  return prisma.carts.create({
    data: { client_id },
  });
}

async function load_cart_items(cart_id: string) {
  return prisma.cart_items.findMany({
    where: { cart_id },
    orderBy: { id: "asc" },
    include: cart_item_include,
  });
}

export async function get_cart(payload: AuthUserPayload): Promise<SerializedCart> {
  const client_id = assert_approved_client(payload);
  const cart = await get_or_create_cart(client_id);
  const items = await load_cart_items(cart.id);
  return serialize_cart(items);
}

async function load_product_for_mutation(product_id: string): Promise<CartProductRow> {
  const product = await prisma.products.findUnique({
    where: { id: product_id },
    include: {
      category: { select: { is_active: true } },
    },
  });

  if (!product) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  if (!product.is_active) {
    throw new AppError(400, "validation_error", "Товар недоступен");
  }

  if (!product.category?.is_active) {
    throw new AppError(400, "validation_error", "Категория товара недоступна");
  }

  if (product.availability === "out_of_stock") {
    throw new AppError(400, "validation_error", "Товара временно нет");
  }

  return product;
}

function assert_qty_for_product(product: CartProductRow, qty: number) {
  const check = check_qty(
    {
      units_per_package: product.units_per_package,
      min_order_qty: product.min_order_qty,
      allow_piece_sale: product.allow_piece_sale,
      availability: product.availability,
      is_active: product.is_active,
    },
    qty,
  );

  if (!check.valid) {
    throw new AppError(
      400,
      "validation_error",
      check.message ?? "Некорректное количество",
    );
  }

  if (!can_add_to_cart({
    units_per_package: product.units_per_package,
    min_order_qty: product.min_order_qty,
    allow_piece_sale: product.allow_piece_sale,
    availability: product.availability,
    is_active: product.is_active,
  })) {
    throw new AppError(400, "validation_error", "Товара временно нет");
  }
}

export async function add_cart_item(
  payload: AuthUserPayload,
  input: { product_id: string; qty: number },
): Promise<SerializedCart> {
  const client_id = assert_approved_client(payload);
  const product = await load_product_for_mutation(input.product_id);

  return prisma.$transaction(async (tx) => {
    let cart = await tx.carts.findUnique({ where: { client_id } });
    if (!cart) {
      cart = await tx.carts.create({ data: { client_id } });
    }

    const existing = await tx.cart_items.findUnique({
      where: {
        cart_id_product_id: {
          cart_id: cart.id,
          product_id: input.product_id,
        },
      },
    });

    const next_qty = existing ? existing.qty + input.qty : input.qty;
    assert_qty_for_product(product, next_qty);

    if (existing) {
      await tx.cart_items.update({
        where: { id: existing.id },
        data: { qty: next_qty },
      });
    } else {
      await tx.cart_items.create({
        data: {
          cart_id: cart.id,
          product_id: input.product_id,
          qty: next_qty,
        },
      });
    }

    await tx.carts.update({
      where: { id: cart.id },
      data: { updated_at: new Date() },
    });

    const items = await tx.cart_items.findMany({
      where: { cart_id: cart.id },
      orderBy: { id: "asc" },
      include: cart_item_include,
    });

    return serialize_cart(items);
  });
}

export async function update_cart_item(
  payload: AuthUserPayload,
  product_id: string,
  qty: number,
): Promise<SerializedCart> {
  const client_id = assert_approved_client(payload);
  const product = await load_product_for_mutation(product_id);
  assert_qty_for_product(product, qty);

  return prisma.$transaction(async (tx) => {
    const cart = await tx.carts.findUnique({ where: { client_id } });
    if (!cart) {
      throw new AppError(404, "not_found", "Позиция не найдена в корзине");
    }

    const existing = await tx.cart_items.findUnique({
      where: {
        cart_id_product_id: {
          cart_id: cart.id,
          product_id,
        },
      },
    });

    if (!existing) {
      throw new AppError(404, "not_found", "Позиция не найдена в корзине");
    }

    await tx.cart_items.update({
      where: { id: existing.id },
      data: { qty },
    });

    await tx.carts.update({
      where: { id: cart.id },
      data: { updated_at: new Date() },
    });

    const items = await tx.cart_items.findMany({
      where: { cart_id: cart.id },
      orderBy: { id: "asc" },
      include: cart_item_include,
    });

    return serialize_cart(items);
  });
}

export async function remove_cart_item(
  payload: AuthUserPayload,
  product_id: string,
): Promise<SerializedCart> {
  const client_id = assert_approved_client(payload);

  return prisma.$transaction(async (tx) => {
    const cart = await tx.carts.findUnique({ where: { client_id } });
    if (!cart) {
      return serialize_cart([]);
    }

    await tx.cart_items.deleteMany({
      where: { cart_id: cart.id, product_id },
    });

    await tx.carts.update({
      where: { id: cart.id },
      data: { updated_at: new Date() },
    });

    const items = await tx.cart_items.findMany({
      where: { cart_id: cart.id },
      orderBy: { id: "asc" },
      include: cart_item_include,
    });

    return serialize_cart(items);
  });
}

export async function clear_cart(
  payload: AuthUserPayload,
): Promise<SerializedCart> {
  const client_id = assert_approved_client(payload);

  return prisma.$transaction(async (tx) => {
    const cart = await tx.carts.findUnique({ where: { client_id } });
    if (!cart) {
      return serialize_cart([]);
    }

    await tx.cart_items.deleteMany({ where: { cart_id: cart.id } });
    await tx.carts.update({
      where: { id: cart.id },
      data: { updated_at: new Date() },
    });

    return serialize_cart([]);
  });
}
