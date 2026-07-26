import { z } from "zod";
import { today_date_key } from "@/lib/dates";
import { normalize_ru_phone } from "@/lib/phone";

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

export const create_order_schema = z
  .object({
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
    contact_phone: z.string().trim().min(1, "Укажите номер телефона"),
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
  })
  .superRefine((data, ctx) => {
    if (data.desired_delivery_date < today_date_key()) {
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
  })
  .transform((data) => ({
    ...data,
    contact_phone: normalize_ru_phone(data.contact_phone) as string,
    client_comment:
      data.client_comment && data.client_comment.trim()
        ? data.client_comment.trim()
        : null,
  }));

export const idempotency_key_schema = z
  .string()
  .uuid("Некорректный Idempotency-Key");

export type CreateOrderInput = z.infer<typeof create_order_schema>;
