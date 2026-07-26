import { z } from "zod";
import { today_date_key } from "@/lib/dates";
import { normalize_ru_phone } from "@/lib/phone";
import { ORDER_STATUSES } from "@/lib/orders/constants";

export const PAYMENT_METHODS = [
  "bank_transfer",
  "deferred",
  "cash_on_delivery",
  "transfer",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Безналичная оплата по счёту",
  deferred: "Оплата с отсрочкой",
  cash_on_delivery: "Наличными при получении",
  transfer: "Перевод",
};

const phone_field = z.string().trim().min(1, "Укажите номер телефона");

const delivery_fields = {
  address: z.string().trim().min(1, "Укажите адрес доставки").max(1000),
  desired_delivery_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Выберите желаемую дату доставки"),
  contact_name: z
    .string()
    .trim()
    .min(2, "Укажите контактное лицо")
    .max(255),
  contact_phone: phone_field,
  payment_method: z.enum(PAYMENT_METHODS, {
    error: "Выберите способ оплаты",
  }),
  is_urgent: z.boolean().default(false),
  client_comment: z
    .string()
    .trim()
    .max(2000, "Комментарий слишком длинный")
    .nullable()
    .optional(),
};

function refine_delivery_and_phone<
  T extends {
    desired_delivery_date: string;
    contact_phone: string;
    client_comment?: string | null;
  },
>(data: T, ctx: z.RefinementCtx, options?: { allow_past_date?: boolean }) {
  if (!options?.allow_past_date && data.desired_delivery_date < today_date_key()) {
    ctx.addIssue({
      code: "custom",
      path: ["desired_delivery_date"],
      message: "Дата доставки не может быть в прошлом",
    });
  }

  const phone = normalize_ru_phone(data.contact_phone);
  if (!phone) {
    ctx.addIssue({
      code: "custom",
      path: ["contact_phone"],
      message: "Укажите номер телефона",
    });
  }
}

function transform_delivery<
  T extends {
    contact_phone: string;
    client_comment?: string | null;
  },
>(data: T) {
  return {
    ...data,
    contact_phone: normalize_ru_phone(data.contact_phone) as string,
    client_comment:
      data.client_comment && data.client_comment.trim()
        ? data.client_comment.trim()
        : null,
  };
}

export const create_order_schema = z
  .object(delivery_fields)
  .superRefine((data, ctx) => refine_delivery_and_phone(data, ctx))
  .transform(transform_delivery);

export const order_item_input_schema = z.object({
  product_id: z.string().uuid("Некорректный товар"),
  qty: z.coerce.number().int("Количество должно быть целым числом"),
});

export const update_client_order_schema = z
  .object({
    ...delivery_fields,
    items: z
      .array(order_item_input_schema)
      .min(1, "Добавьте хотя бы один товар в заказ"),
  })
  .superRefine((data, ctx) => {
    refine_delivery_and_phone(data, ctx);

    const seen = new Set<string>();
    for (const [index, item] of data.items.entries()) {
      if (seen.has(item.product_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "product_id"],
          message: "Товар уже добавлен в заказ",
        });
      }
      seen.add(item.product_id);
    }
  })
  .transform(transform_delivery);

export const cancel_client_order_schema = z.object({
  reason: z
    .string()
    .trim()
    .max(1000, "Причина отмены слишком длинная")
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value === "") return null;
      return value;
    }),
});

export const client_orders_query_schema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
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
  q: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
});

export const order_id_param_schema = z.string().uuid("Некорректный заказ");

export const idempotency_key_schema = z
  .string()
  .uuid("Некорректный Idempotency-Key");

export type CreateOrderInput = z.infer<typeof create_order_schema>;
export type UpdateClientOrderInput = z.infer<typeof update_client_order_schema>;
export type CancelClientOrderInput = z.infer<typeof cancel_client_order_schema>;
export type ClientOrdersQuery = z.infer<typeof client_orders_query_schema>;
