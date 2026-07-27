import { z } from "zod";
import {
  AVAILABILITY_VALUES,
  PRODUCT_SORT_OPTIONS,
  SALE_UNITS,
  SALES_STATUS_VALUES,
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
      "Символьный код: только латиница, цифры и дефис",
    ),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const category_update_schema = category_create_schema.partial();

/** Empty string / null / undefined → null; otherwise finite number >= 0 (positive checked later). */
const optional_price_amount_schema = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z.union([
  z.null(),
  z.coerce
    .number({ error: "Укажите корректную цену" })
    .finite("Укажите корректную цену")
    .min(0, "Цена не может быть отрицательной"),
]));

function refine_sales_and_price(
  data: {
    sales_status?: string;
    price_amount?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  const status = data.sales_status;
  const price = data.price_amount;

  if (price !== null && price !== undefined && price <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "Цена должна быть больше нуля",
      path: ["price_amount"],
    });
  }

  if (status === "orderable") {
    if (price === null || price === undefined || price <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Для режима «Доступен для заказа» укажите цену больше нуля",
        path: ["price_amount"],
      });
    }
  }
}

/** Fields without defaults — safe to `.partial()` for PATCH. */
const product_fields_schema = z.object({
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
  allow_piece_sale: z.boolean(),
  description: z.string().trim().max(5000).nullable().optional(),
  availability: z.enum(AVAILABILITY_VALUES, {
    error: "Выберите статус наличия",
  }),
  sales_status: z.enum(SALES_STATUS_VALUES, {
    error: "Выберите режим продажи",
  }),
  is_promo: z.boolean(),
  is_new: z.boolean(),
  is_hit: z.boolean(),
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
          "Укажите корректный адрес изображения",
        ),
    ])
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  is_active: z.boolean(),
  price_amount: optional_price_amount_schema,
  price_currency: z.literal("RUB"),
});

export const product_create_schema = product_fields_schema
  .extend({
    allow_piece_sale: z.boolean().default(false),
    is_promo: z.boolean().default(false),
    is_new: z.boolean().default(false),
    is_hit: z.boolean().default(false),
    is_active: z.boolean().default(true),
    sales_status: z.enum(SALES_STATUS_VALUES).default("showcase"),
    price_currency: z.literal("RUB").default("RUB"),
    price_amount: optional_price_amount_schema.default(null),
  })
  .superRefine((data, ctx) => refine_sales_and_price(data, ctx));

export const product_update_schema = product_fields_schema
  .partial()
  .superRefine((data, ctx) => {
    // Partial updates: only validate orderable+price when both/enough fields present.
    if (data.sales_status === "orderable") {
      if (
        data.price_amount === null ||
        (data.price_amount !== undefined && data.price_amount <= 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Для режима «Доступен для заказа» укажите цену больше нуля",
          path: ["price_amount"],
        });
      }
    }
    if (
      data.price_amount !== undefined &&
      data.price_amount !== null &&
      data.price_amount <= 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Цена должна быть больше нуля",
        path: ["price_amount"],
      });
    }
  });

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
  sales_status: z.enum(SALES_STATUS_VALUES).optional(),
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
  sales_status: z.enum(SALES_STATUS_VALUES).optional(),
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

export const product_interest_create_schema = z.object({
  request_type: z.enum(["interest", "price_request"], {
    error: "Укажите тип запроса",
  }),
  requested_qty: z.preprocess((value) => {
    if (value === null || value === undefined || value === "") return null;
    return value;
  }, z.union([
    z.null(),
    z.coerce.number().int().min(1, "Количество должно быть не меньше 1"),
  ]).optional()),
  comment: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : null)),
});

export const staff_interest_query_schema = z.object({
  status: z.enum(["new", "contacted", "closed"]).optional(),
  product_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  manager_id: z.string().uuid().optional(),
  date_from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата")
    .optional(),
  date_to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата")
    .optional(),
  sort: z
    .enum(["newest", "most_requests", "most_clients"])
    .default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const staff_interest_status_schema = z.object({
  status: z.enum(["new", "contacted", "closed"]),
});
