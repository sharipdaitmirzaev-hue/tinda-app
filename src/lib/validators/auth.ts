import { z } from "zod";

const phone_regex = /^\+?[0-9()\-\s]{10,20}$/;

export const register_schema = z
  .object({
    company_name: z
      .string()
      .trim()
      .min(2, "Укажите название компании или торговой точки")
      .max(200, "Название слишком длинное"),
    inn: z
      .string()
      .trim()
      .regex(/^\d{10}$|^\d{12}$/, "ИНН должен содержать 10 или 12 цифр"),
    kpp: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "КПП должен содержать 9 цифр")
      .optional()
      .nullable()
      .or(z.literal("")),
    legal_name: z.string().trim().max(255).optional().nullable().or(z.literal("")),
    legal_address: z.string().trim().optional().nullable().or(z.literal("")),
    city_id: z.string().uuid("Выберите город из списка"),
    client_type: z
      .enum([
        "shop",
        "cafe",
        "restaurant",
        "hotel",
        "wholesaler",
        "banquet_hall",
        "other",
      ])
      .optional()
      .nullable(),
    contact_name: z
      .string()
      .trim()
      .min(2, "Укажите имя контактного лица")
      .max(255),
    phone: z
      .string()
      .trim()
      .regex(phone_regex, "Укажите корректный номер телефона"),
    extra_phone: z
      .string()
      .trim()
      .regex(phone_regex, "Укажите корректный дополнительный телефон")
      .optional()
      .nullable()
      .or(z.literal("")),
    email: z
      .string()
      .trim()
      .email("Укажите корректный email")
      .max(255),
    address: z
      .string()
      .trim()
      .min(5, "Укажите адрес торговой точки или доставки")
      .max(1000),
    comment: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
    password: z
      .string()
      .min(8, "Пароль должен быть не короче 8 символов")
      .max(200),
    password_confirm: z.string(),
    pdn_accepted: z.literal(true, {
      error: "Необходимо согласие на обработку персональных данных",
    }),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"],
  });

export const login_schema = z.object({
  login: z.string().trim().min(1, "Укажите email или телефон"),
  password: z.string().min(1, "Укажите пароль"),
});

export type RegisterInput = z.infer<typeof register_schema>;
export type LoginInput = z.infer<typeof login_schema>;

export function empty_to_null(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }
  return value.trim();
}
