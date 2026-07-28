"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RejectRequestModal } from "@/components/staff/reject-request-modal";
import { client_status_label } from "@/lib/i18n/labels";
import { UI_GENERIC_ERROR } from "@/lib/i18n/ui-copy";

type ManagerOption = {
  id: string;
  full_name: string;
  email: string;
};

type RequestDetail = {
  id: string;
  company_name: string;
  inn: string;
  kpp: string | null;
  legal_name: string | null;
  legal_address: string | null;
  city: { id: string; name: string; region: string };
  client_type: string | null;
  client_type_label: string | null;
  contact_name: string;
  phone: string;
  extra_phone: string | null;
  email: string;
  address: string;
  comment: string | null;
  created_at: string;
  status: string;
  rejected_reason: string | null;
  manager: { id: string; full_name: string; email: string } | null;
};

type Props = {
  initial_request: RequestDetail;
  managers: ManagerOption[];
  can_assign_manager: boolean;
};

export function RegistrationRequestDetail({
  initial_request,
  managers,
  can_assign_manager,
}: Props) {
  const router = useRouter();
  const [request, set_request] = useState(initial_request);
  const [manager_id, set_manager_id] = useState<string>("");
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);
  const [reject_open, set_reject_open] = useState(false);

  const is_pending = request.status === "pending";

  async function on_approve() {
    set_loading(true);
    set_error(null);
    set_message(null);
    try {
      const body: { manager_id?: string | null } = {};
      if (can_assign_manager) {
        body.manager_id = manager_id ? manager_id : null;
      }

      const response = await fetch(
        `/api/v1/staff/registration-requests/${request.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось подтвердить клиента");
      }
      set_message(data.message ?? "Клиент подтверждён");
      set_request(data.request);
      router.push("/staff/registration-requests?flash=approved");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_loading(false);
    }
  }

  async function on_reject(reason: string) {
    set_loading(true);
    set_error(null);
    set_message(null);
    try {
      const response = await fetch(
        `/api/v1/staff/registration-requests/${request.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось отклонить заявку");
      }
      set_reject_open(false);
      set_message(data.message ?? "Заявка отклонена");
      set_request(data.request);
      router.push("/staff/registration-requests?status=rejected&flash=rejected");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_loading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/staff/registration-requests"
            className="text-sm text-teal-800 underline-offset-2 hover:underline"
          >
            ← К списку заявок
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            {request.company_name}
          </h1>
          <p className="text-sm text-slate-600">
            Статус: {client_status_label(request.status)}
          </p>
        </div>
      </div>

      {message ? (
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <Field label="Название компании" value={request.company_name} />
        <Field label="ИНН" value={request.inn} />
        <Field label="КПП" value={request.kpp} />
        <Field label="Юридическое наименование" value={request.legal_name} />
        <Field label="Юридический адрес" value={request.legal_address} />
        <Field
          label="Город"
          value={`${request.city.name} (${request.city.region})`}
        />
        <Field label="Тип клиента" value={request.client_type_label} />
        <Field label="Контактное лицо" value={request.contact_name} />
        <Field label="Телефон" value={request.phone} />
        <Field label="Доп. телефон" value={request.extra_phone} />
        <Field label="Эл. почта" value={request.email} />
        <Field label="Адрес доставки" value={request.address} />
        <Field label="Комментарий" value={request.comment} />
        <Field
          label="Дата регистрации"
          value={new Date(request.created_at).toLocaleString("ru-RU")}
        />
        <Field
          label="Менеджер"
          value={request.manager?.full_name ?? "Не назначен"}
        />
        {request.rejected_reason ? (
          <Field label="Причина отклонения" value={request.rejected_reason} />
        ) : null}
      </dl>

      {is_pending ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          {can_assign_manager ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Ответственный менеджер
              </span>
              <select
                value={manager_id}
                onChange={(e) => set_manager_id(e.target.value)}
                className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Без менеджера</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.full_name} ({manager.email})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-slate-600">
              После подтверждения клиент будет закреплён за вами.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={on_approve}
              disabled={loading}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {loading ? "Сохранение…" : "Подтвердить клиента"}
            </button>
            <button
              type="button"
              onClick={() => set_reject_open(true)}
              disabled={loading}
              className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Отклонить заявку
            </button>
          </div>
        </div>
      ) : null}

      <RejectRequestModal
        open={reject_open}
        loading={loading}
        on_close={() => set_reject_open(false)}
        on_submit={on_reject}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}
