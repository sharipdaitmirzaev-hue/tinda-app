import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { get_support_contacts } from "@/lib/access";
import { get_post_auth_path, type AuthUserPayload } from "@/lib/access";

export type RegistrationStatusResponse = {
  status: string;
  rejected_reason: string | null;
  company_name: string;
  support_email: string | null;
  support_phone: string | null;
  redirect_to: string;
};

export async function get_registration_status(
  payload: AuthUserPayload,
): Promise<RegistrationStatusResponse> {
  if (!payload.client) {
    throw new AppError(403, "forbidden", "Доступно только для клиентов");
  }

  const client = await prisma.clients.findUnique({
    where: { id: payload.client.id },
    select: {
      status: true,
      rejected_reason: true,
      company_name: true,
    },
  });

  if (!client) {
    throw new AppError(404, "not_found", "Клиент не найден");
  }

  const [support_email_row, support_phone_row] = await Promise.all([
    prisma.settings.findUnique({ where: { key: "support_email" } }),
    prisma.settings.findUnique({ where: { key: "support_phone" } }),
  ]);

  const support = get_support_contacts({
    support_email: support_email_row?.value,
    support_phone: support_phone_row?.value,
  });

  const refreshed: AuthUserPayload = {
    ...payload,
    client: {
      id: payload.client.id,
      status: client.status,
      company_name: client.company_name,
    },
  };

  return {
    status: client.status,
    rejected_reason: client.rejected_reason,
    company_name: client.company_name,
    support_email: support.support_email,
    support_phone: support.support_phone,
    redirect_to: get_post_auth_path(refreshed),
  };
}
