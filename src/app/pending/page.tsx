import { LogoutButton } from "@/components/auth/logout-button";
import { RefreshStatusButton } from "@/components/auth/refresh-status-button";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { get_support_contacts } from "@/lib/access";
import { prisma } from "@/lib/db";

export default async function PendingPage() {
  // Access enforced in layout via require_pending_client
  const auth = await get_current_auth_payload();
  const client_id = auth?.client?.id;
  if (!client_id) {
    return null;
  }

  const client = await prisma.clients.findUnique({
    where: { id: client_id },
    select: {
      status: true,
      rejected_reason: true,
      company_name: true,
    },
  });

  const [support_email_row, support_phone_row] = await Promise.all([
    prisma.settings.findUnique({ where: { key: "support_email" } }),
    prisma.settings.findUnique({ where: { key: "support_phone" } }),
  ]);

  const support = get_support_contacts({
    support_email: support_email_row?.value,
    support_phone: support_phone_row?.value,
  });

  const status = client?.status ?? "pending";
  const company_name = client?.company_name ?? auth.client!.company_name;
  const rejected_reason = client?.rejected_reason;

  const title =
    status === "blocked"
      ? "Доступ заблокирован"
      : status === "rejected"
        ? "Заявка отклонена"
        : "Заявка на рассмотрении";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-teal-50 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-5 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
              ТИНДА
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
          </div>
          <LogoutButton />
        </div>

        <p className="text-slate-700">
          Компания: <strong>{company_name}</strong>
        </p>

        {status === "pending" ? (
          <p className="text-slate-600">
            Ваша заявка находится на рассмотрении. Менеджер проверит данные и
            откроет доступ к каталогу и заказам.
          </p>
        ) : null}

        {status === "rejected" ? (
          <div className="space-y-2 rounded-md bg-red-50 px-3 py-3 text-sm text-red-800">
            <p className="font-medium">Заявка отклонена</p>
            {rejected_reason ? (
              <p>Причина: {rejected_reason}</p>
            ) : (
              <p>Причина отклонения не указана. Свяжитесь с поддержкой.</p>
            )}
          </div>
        ) : null}

        {status === "blocked" ? (
          <p className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
            Доступ заблокирован. Свяжитесь с менеджером.
          </p>
        ) : null}

        <div className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Контакты поддержки</p>
          <p>Email: {support.support_email ?? "support@tinda.ru"}</p>
          {support.support_phone ? <p>Телефон: {support.support_phone}</p> : null}
        </div>

        {status === "pending" || status === "rejected" ? (
          <RefreshStatusButton />
        ) : null}

        <p className="text-xs text-slate-500">
          Каталог, корзина и заказы недоступны при статусе «{status}».
        </p>
      </div>
    </main>
  );
}
