import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  assert_catalog_editor,
  can_see_client_prices,
  type AuthUserPayload,
} from "@/lib/access";
import type { ProductSort } from "@/lib/catalog/constants";
import {
  serialize_approved_client_product,
  serialize_approved_client_product_detail,
  serialize_public_product,
  serialize_public_product_detail,
  serialize_staff_product,
} from "@/lib/catalog/product-serializers";
import {
  assert_non_negative_price,
  assert_positive_price_if_set,
  money_round,
  type MoneyInput,
} from "@/lib/money";
import {
  delete_product_image,
  extract_product_image_storage_key,
  upload_product_image as store_product_image,
} from "@/lib/storage/product-images";

function empty_to_null(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  return value.trim();
}

function assert_valid_price_amount(amount: MoneyInput, label = "Цена") {
  try {
    assert_non_negative_price(amount, label);
    assert_positive_price_if_set(amount, label);
  } catch (error) {
    throw new AppError(
      400,
      "validation_error",
      error instanceof Error ? error.message : `${label} указана некорректно`,
    );
  }
}

/** Validate sales_status + price. Active products may have null price (showcase). */
function assert_sales_status_price(input: {
  sales_status: string;
  price_amount: MoneyInput | null | undefined;
}) {
  const price = input.price_amount;
  if (price !== null && price !== undefined) {
    assert_valid_price_amount(price);
  }
  if (input.sales_status === "orderable") {
    if (price === null || price === undefined) {
      throw new AppError(
        400,
        "validation_error",
        "Для режима «Доступен для заказа» укажите цену больше нуля",
      );
    }
  }
}

function normalize_price_for_db(
  price_amount: number | null | undefined,
): ReturnType<typeof money_round> | null {
  if (price_amount === null || price_amount === undefined) return null;
  return money_round(price_amount);
}

function sort_to_order(
  sort: ProductSort,
): Prisma.productsOrderByWithRelationInput | Prisma.productsOrderByWithRelationInput[] {
  switch (sort) {
    case "name_asc":
      return { name: "asc" };
    case "name_desc":
      return { name: "desc" };
    case "created_at_asc":
      return { created_at: "asc" };
    case "is_new_desc":
      return [{ is_new: "desc" }, { created_at: "desc" }, { name: "asc" }];
    case "is_hit_desc":
      return [{ is_hit: "desc" }, { name: "asc" }];
    case "brand_asc":
      return [{ brand: "asc" }, { name: "asc" }];
    case "volume_asc":
      return [{ volume_text: "asc" }, { name: "asc" }];
    case "has_price_desc":
      return [{ price_amount: "desc" }, { name: "asc" }];
    case "created_at_desc":
    default:
      return { created_at: "desc" };
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolve_catalog_category_ids(
  category?: string | null,
  category_id?: string | null,
): Promise<string[] | null> {
  const raw = (category || category_id || "").trim();
  if (!raw) return null;

  const category_row = UUID_RE.test(raw)
    ? await prisma.categories.findFirst({
        where: { id: raw, is_active: true },
        select: { id: true },
      })
    : await prisma.categories.findFirst({
        where: { slug: raw, is_active: true },
        select: { id: true },
      });

  if (!category_row) {
    return [];
  }

  const ids = new Set<string>([category_row.id]);
  let frontier = [category_row.id];
  while (frontier.length) {
    const children = await prisma.categories.findMany({
      where: { parent_id: { in: frontier }, is_active: true },
      select: { id: true },
    });
    frontier = [];
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        frontier.push(child.id);
      }
    }
  }
  return [...ids];
}

function build_catalog_where(params: {
  q?: string;
  category_ids?: string[] | null;
  brand?: string;
  volume?: string;
  package_type?: string;
  availability?: string;
  sales_status?: string;
  is_promo?: boolean;
  is_new?: boolean;
  is_hit?: boolean;
  has_price?: boolean;
}): Prisma.productsWhereInput {
  const where: Prisma.productsWhereInput = {
    is_active: true,
    category: { is_active: true },
  };

  if (params.category_ids) {
    if (params.category_ids.length === 0) {
      where.id = { in: [] };
    } else {
      where.category_id = { in: params.category_ids };
    }
  }
  if (params.brand?.trim()) {
    where.brand = { equals: params.brand.trim(), mode: "insensitive" };
  }
  if (params.volume?.trim()) {
    where.volume_text = { equals: params.volume.trim(), mode: "insensitive" };
  }
  if (params.package_type?.trim()) {
    where.package_type = {
      equals: params.package_type.trim(),
      mode: "insensitive",
    };
  }
  if (params.availability) where.availability = params.availability;
  if (params.sales_status) where.sales_status = params.sales_status;
  if (params.is_promo !== undefined) where.is_promo = params.is_promo;
  if (params.is_new !== undefined) where.is_new = params.is_new;
  if (params.is_hit !== undefined) where.is_hit = params.is_hit;
  if (params.has_price === true) {
    where.price_amount = { gt: 0 };
  } else if (params.has_price === false) {
    where.OR = [{ price_amount: null }, { price_amount: { lte: 0 } }];
  }
  if (params.q?.trim()) {
    const q = params.q.trim();
    const search_or: Prisma.productsWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: search_or }];
      delete where.OR;
    } else {
      where.OR = search_or;
    }
  }

  return where;
}

async function load_catalog_facets(where: Prisma.productsWhereInput) {
  const [brand_rows, volume_rows, package_rows, category_rows] =
    await Promise.all([
      prisma.products.findMany({
        where: { ...where, brand: { not: null } },
        distinct: ["brand"],
        select: { brand: true },
        orderBy: { brand: "asc" },
        take: 200,
      }),
      prisma.products.findMany({
        where: { ...where, volume_text: { not: null } },
        distinct: ["volume_text"],
        select: { volume_text: true },
        orderBy: { volume_text: "asc" },
        take: 200,
      }),
      prisma.products.findMany({
        where: { ...where, package_type: { not: null } },
        distinct: ["package_type"],
        select: { package_type: true },
        orderBy: { package_type: "asc" },
        take: 200,
      }),
      prisma.products.findMany({
        where,
        distinct: ["category_id"],
        select: {
          category_id: true,
          category: { select: { id: true, name: true, slug: true } },
        },
        take: 200,
      }),
    ]);

  return {
    brands: brand_rows
      .map((row) => row.brand)
      .filter((value): value is string => Boolean(value && value.trim())),
    volumes: volume_rows
      .map((row) => row.volume_text)
      .filter((value): value is string => Boolean(value && value.trim())),
    package_types: package_rows
      .map((row) => row.package_type)
      .filter((value): value is string => Boolean(value && value.trim())),
    categories: category_rows
      .map((row) => row.category)
      .filter(
        (category): category is { id: string; name: string; slug: string } =>
          Boolean(category),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}

function map_catalog_list_item(
  payload: AuthUserPayload | null,
  product: Parameters<typeof serialize_public_product>[0],
) {
  return can_see_client_prices(payload)
    ? serialize_approved_client_product(product)
    : serialize_public_product(product);
}

function map_catalog_detail(
  payload: AuthUserPayload | null,
  product: Parameters<typeof serialize_public_product_detail>[0],
) {
  return can_see_client_prices(payload)
    ? serialize_approved_client_product_detail(product)
    : serialize_public_product_detail(product);
}

export async function list_staff_products(
  payload: AuthUserPayload,
  params: {
    q?: string;
    category_id?: string;
    availability?: string;
    sales_status?: string;
    is_active?: boolean;
    is_promo?: boolean;
    is_new?: boolean;
    is_hit?: boolean;
    page: number;
    page_size: number;
    sort: ProductSort;
  },
) {
  assert_catalog_editor(payload);

  const where: Prisma.productsWhereInput = {};
  if (params.category_id) where.category_id = params.category_id;
  if (params.availability) where.availability = params.availability;
  if (params.sales_status) where.sales_status = params.sales_status;
  if (params.is_active !== undefined) where.is_active = params.is_active;
  if (params.is_promo !== undefined) where.is_promo = params.is_promo;
  if (params.is_new !== undefined) where.is_new = params.is_new;
  if (params.is_hit !== undefined) where.is_hit = params.is_hit;
  if (params.q?.trim()) {
    const q = params.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
    ];
  }

  const skip = (params.page - 1) * params.page_size;
  const [total, items] = await Promise.all([
    prisma.products.count({ where }),
    prisma.products.findMany({
      where,
      orderBy: sort_to_order(params.sort),
      skip,
      take: params.page_size,
      include: {
        category: { select: { id: true, name: true, is_active: true } },
      },
    }),
  ]);

  return {
    items: items.map(serialize_staff_product),
    page: params.page,
    page_size: params.page_size,
    total,
  };
}

export async function get_staff_product(
  payload: AuthUserPayload,
  product_id: string,
) {
  assert_catalog_editor(payload);
  const product = await prisma.products.findUnique({
    where: { id: product_id },
    include: {
      category: { select: { id: true, name: true, is_active: true } },
    },
  });
  if (!product) {
    throw new AppError(404, "not_found", "Товар не найден");
  }
  return { product: serialize_staff_product(product) };
}

async function assert_category_exists(category_id: string) {
  const category = await prisma.categories.findUnique({
    where: { id: category_id },
  });
  if (!category) {
    throw new AppError(400, "validation_error", "Категория не найдена");
  }
  return category;
}

export async function create_product(
  payload: AuthUserPayload,
  input: {
    sku: string;
    name: string;
    brand?: string | null;
    category_id: string;
    volume_text?: string | null;
    package_type?: string | null;
    units_per_package: number;
    sale_unit: string;
    min_order_qty: number;
    allow_piece_sale?: boolean;
    description?: string | null;
    availability: string;
    is_promo?: boolean;
    is_new?: boolean;
    is_hit?: boolean;
    image_url?: string | null;
    is_active?: boolean;
    sales_status?: string;
    price_amount?: number | null;
    price_currency?: "RUB";
  },
) {
  assert_catalog_editor(payload);
  await assert_category_exists(input.category_id);

  if (input.units_per_package < 1 || input.min_order_qty < 1) {
    throw new AppError(
      400,
      "validation_error",
      "units_per_package и min_order_qty должны быть не меньше 1",
    );
  }

  const is_active = input.is_active ?? true;
  const sales_status = input.sales_status ?? "showcase";
  assert_sales_status_price({
    sales_status,
    price_amount: input.price_amount,
  });

  const existing = await prisma.products.findUnique({
    where: { sku: input.sku.trim() },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Артикул уже используется");
  }

  const product = await prisma.products.create({
    data: {
      sku: input.sku.trim(),
      name: input.name.trim(),
      brand: empty_to_null(input.brand),
      category_id: input.category_id,
      volume_text: empty_to_null(input.volume_text),
      package_type: empty_to_null(input.package_type),
      units_per_package: input.units_per_package,
      sale_unit: input.sale_unit,
      min_order_qty: input.min_order_qty,
      allow_piece_sale: input.allow_piece_sale ?? false,
      description: empty_to_null(input.description),
      availability: input.availability,
      sales_status,
      is_promo: input.is_promo ?? false,
      is_new: input.is_new ?? false,
      is_hit: input.is_hit ?? false,
      image_url: empty_to_null(input.image_url),
      is_active,
      price_amount: normalize_price_for_db(input.price_amount),
      price_currency: input.price_currency ?? "RUB",
    },
    include: {
      category: { select: { id: true, name: true, is_active: true } },
    },
  });

  return { product: serialize_staff_product(product), message: "Товар создан" };
}

export async function update_product(
  payload: AuthUserPayload,
  product_id: string,
  input: Partial<{
    sku: string;
    name: string;
    brand: string | null;
    category_id: string;
    volume_text: string | null;
    package_type: string | null;
    units_per_package: number;
    sale_unit: string;
    min_order_qty: number;
    allow_piece_sale: boolean;
    description: string | null;
    availability: string;
    is_promo: boolean;
    is_new: boolean;
    is_hit: boolean;
    image_url: string | null;
    is_active: boolean;
    sales_status: string;
    price_amount: number | null;
    price_currency: "RUB";
  }>,
) {
  assert_catalog_editor(payload);

  const current = await prisma.products.findUnique({
    where: { id: product_id },
  });
  if (!current) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  if (input.category_id) {
    await assert_category_exists(input.category_id);
  }

  if (input.units_per_package !== undefined && input.units_per_package < 1) {
    throw new AppError(
      400,
      "validation_error",
      "Количество в упаковке должно быть не меньше 1",
    );
  }
  if (input.min_order_qty !== undefined && input.min_order_qty < 1) {
    throw new AppError(
      400,
      "validation_error",
      "Минимальный заказ должен быть не меньше 1",
    );
  }

  const next_sales_status =
    input.sales_status !== undefined ? input.sales_status : current.sales_status;
  const next_price =
    input.price_amount !== undefined ? input.price_amount : current.price_amount;
  assert_sales_status_price({
    sales_status: next_sales_status,
    price_amount: next_price,
  });

  if (input.sku && input.sku.trim() !== current.sku) {
    const existing = await prisma.products.findUnique({
      where: { sku: input.sku.trim() },
    });
    if (existing) {
      throw new AppError(409, "conflict", "Артикул уже используется");
    }
  }

  const product = await prisma.products.update({
    where: { id: product_id },
    data: {
      ...(input.sku !== undefined ? { sku: input.sku.trim() } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.brand !== undefined ? { brand: empty_to_null(input.brand) } : {}),
      ...(input.category_id !== undefined
        ? { category_id: input.category_id }
        : {}),
      ...(input.volume_text !== undefined
        ? { volume_text: empty_to_null(input.volume_text) }
        : {}),
      ...(input.package_type !== undefined
        ? { package_type: empty_to_null(input.package_type) }
        : {}),
      ...(input.units_per_package !== undefined
        ? { units_per_package: input.units_per_package }
        : {}),
      ...(input.sale_unit !== undefined ? { sale_unit: input.sale_unit } : {}),
      ...(input.min_order_qty !== undefined
        ? { min_order_qty: input.min_order_qty }
        : {}),
      ...(input.allow_piece_sale !== undefined
        ? { allow_piece_sale: input.allow_piece_sale }
        : {}),
      ...(input.description !== undefined
        ? { description: empty_to_null(input.description) }
        : {}),
      ...(input.availability !== undefined
        ? { availability: input.availability }
        : {}),
      ...(input.sales_status !== undefined
        ? { sales_status: input.sales_status }
        : {}),
      ...(input.is_promo !== undefined ? { is_promo: input.is_promo } : {}),
      ...(input.is_new !== undefined ? { is_new: input.is_new } : {}),
      ...(input.is_hit !== undefined ? { is_hit: input.is_hit } : {}),
      ...(input.image_url !== undefined
        ? { image_url: empty_to_null(input.image_url) }
        : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      ...(input.price_amount !== undefined
        ? { price_amount: normalize_price_for_db(input.price_amount) }
        : {}),
      ...(input.price_currency !== undefined
        ? { price_currency: input.price_currency }
        : {}),
    },
    include: {
      category: { select: { id: true, name: true, is_active: true } },
    },
  });

  return { product: serialize_staff_product(product), message: "Товар сохранён" };
}

export async function activate_product(
  payload: AuthUserPayload,
  product_id: string,
) {
  const result = await update_product(payload, product_id, { is_active: true });
  return { product: result.product, message: "Товар активирован" };
}

export async function deactivate_product(
  payload: AuthUserPayload,
  product_id: string,
) {
  const result = await update_product(payload, product_id, { is_active: false });
  return { product: result.product, message: "Товар деактивирован" };
}

export async function upload_product_image(
  payload: AuthUserPayload,
  product_id: string,
  file: {
    buffer: Buffer;
    mime_type?: string | null;
    filename?: string | null;
  },
) {
  assert_catalog_editor(payload);

  const current = await prisma.products.findUnique({
    where: { id: product_id },
  });
  if (!current) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  const previous_url = current.image_url;
  const previous_key = extract_product_image_storage_key(previous_url);

  const stored = await store_product_image({
    product_id,
    buffer: file.buffer,
    mime_type: file.mime_type,
    filename: file.filename,
  });

  try {
    await prisma.products.update({
      where: { id: product_id },
      data: { image_url: stored.image_url },
    });
  } catch (error) {
    await delete_product_image(stored.storage_key).catch(() => undefined);
    throw error;
  }

  if (previous_key && previous_key !== stored.storage_key) {
    await delete_product_image(previous_key).catch((error) => {
      console.error("old product image cleanup failed", {
        product_id,
        storage_key: previous_key,
      });
      void error;
    });
  }

  return {
    product_id,
    image_url: stored.image_url,
  };
}

export async function remove_product_image(
  payload: AuthUserPayload,
  product_id: string,
) {
  assert_catalog_editor(payload);

  const current = await prisma.products.findUnique({
    where: { id: product_id },
  });
  if (!current) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  const previous_url = current.image_url;
  const previous_key = extract_product_image_storage_key(previous_url);

  await prisma.products.update({
    where: { id: product_id },
    data: { image_url: null },
  });

  if (previous_key) {
    await delete_product_image(previous_key).catch((error) => {
      console.error("product image delete after nulling failed", {
        product_id,
        storage_key: previous_key,
      });
      void error;
    });
  } else if (previous_url) {
    // External/manual URL: only clear DB field.
  }

  return {
    product_id,
    image_url: null as string | null,
    message: "Изображение удалено",
  };
}

export async function list_catalog_products(
  payload: AuthUserPayload | null,
  params: {
    q?: string;
    category?: string;
    category_id?: string;
    brand?: string;
    volume?: string;
    package_type?: string;
    availability?: string;
    sales_status?: string;
    is_promo?: boolean;
    is_new?: boolean;
    is_hit?: boolean;
    has_price?: boolean;
    page: number;
    page_size: number;
    sort: ProductSort;
  },
) {
  const category_ids = await resolve_catalog_category_ids(
    params.category,
    params.category_id,
  );

  const where = build_catalog_where({
    q: params.q,
    category_ids,
    brand: params.brand,
    volume: params.volume,
    package_type: params.package_type,
    availability: params.availability,
    sales_status: params.sales_status,
    is_promo: params.is_promo,
    is_new: params.is_new,
    is_hit: params.is_hit,
    has_price: params.has_price,
  });

  // Facets: active catalog universe (not narrowed by current brand/volume/package),
  // so filter dropdowns stay useful while browsing.
  const facet_where = build_catalog_where({
    q: params.q,
    category_ids,
    availability: params.availability,
    sales_status: params.sales_status,
    is_promo: params.is_promo,
    is_new: params.is_new,
    is_hit: params.is_hit,
    has_price: params.has_price,
  });

  const skip = (params.page - 1) * params.page_size;
  const [total, items, filters] = await Promise.all([
    prisma.products.count({ where }),
    prisma.products.findMany({
      where,
      orderBy: sort_to_order(params.sort),
      skip,
      take: params.page_size,
      include: {
        category: {
          select: { id: true, name: true, slug: true, is_active: true },
        },
      },
    }),
    load_catalog_facets(facet_where),
  ]);

  const total_pages = Math.max(1, Math.ceil(total / params.page_size) || 1);

  return {
    items: items.map((product) => map_catalog_list_item(payload, product)),
    page: params.page,
    page_size: params.page_size,
    total,
    total_pages: total === 0 ? 0 : total_pages,
    filters,
  };
}

export async function get_catalog_product(
  payload: AuthUserPayload | null,
  product_id: string,
) {
  const product = await prisma.products.findFirst({
    where: {
      id: product_id,
      is_active: true,
      category: { is_active: true },
    },
    include: {
      category: { select: { id: true, name: true } },
    },
  });

  if (!product) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  return { product: map_catalog_detail(payload, product) };
}

export async function list_public_catalog_categories(
  payload: AuthUserPayload | null,
) {
  void payload;
  const { list_catalog_categories_tree } = await import(
    "@/lib/services/categories.service"
  );
  return list_catalog_categories_tree();
}

/** @deprecated Use list_public_catalog_categories */
export async function list_catalog_categories_for_client(
  payload: AuthUserPayload | null,
) {
  return list_public_catalog_categories(payload);
}
