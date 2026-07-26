import { LogoutButton } from "@/components/auth/logout-button";
import { require_pending_client } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db";

export default async function PendingPage() {
  const auth = await require_pending_client();
  const client = await prisma.clients.findUnique({
    where: { id: auth.client!.id },
    select: {
      status: true,
      rejected_reason: true,
      company_name: true,
    },
  });

  const support_email = await prisma.settings.findUnique({
    where: { key: "support_email" },
  });
  const support_phone = await prisma.settings.findUnique({
    where: { key: "support_phone" },
  });

  const is_rejected = client?.status === "rejected";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
              ТИНДА
            </p>
            <h1 className="mt-2 text-2xl font-semibold">
              {is_rejected ? "Заявка отклонена" : "Заявка на рассмотрении"}
            </h1>
          </div>
          <LogoutButton />
        </div>
        <p className="text-slate-600">
          Компания: <strong>{client?.company_name}</strong>
        </p>
        {is_rejected ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {client?.rejected_reason || "Заявка отклонена менеджером."}
          </p>
        ) : (
          <p className="text-slate-600">
            Оформление заказов станет доступно после подтверждения менеджером.
          </p>
        )}
        <p className="text-sm text-slate-500">
          Поддержка:{" "}
          {typeof support_email?.value === "string"
            ? support_email.value
            : "support@tinda.ru"}
          {typeof support_phone?.value === "string"
            ? ` · ${support_phone.value}`
            : ""}
        </p>
      </div>
    </main>
  );
}
