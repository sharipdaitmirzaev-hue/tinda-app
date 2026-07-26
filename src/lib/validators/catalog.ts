import { z } from "zod";
import {
  AVAILABILITY_VALUES,
  PRODUCT_SORT_OPTIONS,
  SALE_UNITS,
} from "@/lib/catalog/constants";

export const category_create_schema = z.object({
  name: z.string().trim().min(1, "Укажите название категории").max(150),
  slug: z
    .string()
    .trim()
    .min(1, "Укажите slug")
    .max(150)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug: только латиница, цифры и дефис",
    ),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const category_update_schema = category_create_schema.partial();

export const product_create_schema = z.object({
  sku: z.string().trim().min(1, "Укажите артикул").max(64),
  name: z.string().trim().min(1, "Укажите название товара").max(255),
  brand: z.string().trim().max(150).nullable().optional(),
  category_id: z.string().uuid("Выберите категорию"),
  volume_text: z.string().trim().max(100).nullable().optional(),
  package_type: z.string().trim().max(100).nullable().optional(),
  units_per_package: z.coerce
    .number()
    .int()
    .min(1, "Количество в упаковке должно быть не меньше 1"),
  sale_unit: z.enum(SALE_UNITS, {
    error: "Выберите единицу продажи",
  }),
  min_order_qty: z.coerce
    .number()
    .int()
    .min(1, "Минимальный заказ должен быть не меньше 1"),
  allow_piece_sale: z.boolean().default(false),
  description: z.string().trim().max(5000).nullable().optional(),
  availability: z.enum(AVAILABILITY_VALUES, {
    error: "Выберите статус наличия",
  }),
  is_promo: z.boolean().default(false),
  is_new: z.boolean().default(false),
  is_hit: z.boolean().default(false),
  image_url: z
    .union([
      z.literal(""),
      z.null(),
      z
        .string()
        .trim()
        .refine(
          (value) =>
            value.startsWith("/uploads/") ||
            /^https?:\/\//i.test(value),
          "Укажите корректный URL изображения",
        ),
    ])
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  is_active: z.boolean().default(true),
});

export const product_update_schema = product_create_schema.partial();

const optional_bool_query = z
  .enum(["true", "false"])
  .optional()
  .transform((value) =>
    value === undefined ? undefined : value === "true",
  );

export const staff_products_query_schema = z.object({
  q: z.string().trim().max(200).optional(),
  category_id: z.string().uuid().optional(),
  availability: z.enum(AVAILABILITY_VALUES).optional(),
  is_active: optional_bool_query,
  is_promo: optional_bool_query,
  is_new: optional_bool_query,
  is_hit: optional_bool_query,
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(PRODUCT_SORT_OPTIONS).default("created_at_desc"),
});

export const catalog_products_query_schema = z.object({
  q: z.string().trim().max(200).optional(),
  category_id: z.string().uuid().optional(),
  availability: z.enum(AVAILABILITY_VALUES).optional(),
  is_promo: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  is_new: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  is_hit: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(PRODUCT_SORT_OPTIONS).default("name_asc"),
});
