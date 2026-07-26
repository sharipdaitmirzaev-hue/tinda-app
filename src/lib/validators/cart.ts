import { z } from "zod";

export const cart_add_item_schema = z.object({
  product_id: z.string().uuid("Укажите товар"),
  qty: z.coerce.number().int("Количество должно быть целым числом"),
});

export const cart_update_item_schema = z.object({
  qty: z.coerce.number().int("Количество должно быть целым числом"),
});

export const cart_product_id_param_schema = z.string().uuid("Некорректный товар");
