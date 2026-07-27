import { z } from "zod";

export const list_registration_requests_query_schema = z.object({
  status: z.enum(["pending", "rejected"]).default("pending"),
  city_id: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const approve_registration_request_schema = z.object({
  manager_id: z.string().uuid().nullable().optional(),
});

export const reject_registration_request_schema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Укажите причину отклонения")
    .max(2000, "Причина отклонения слишком длинная"),
});
