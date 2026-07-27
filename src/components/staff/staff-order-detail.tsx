"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";

type StaffOrder = {
  id: string;
  number: string;
  status: string;
  status_label: string;
  created_at: string;
  client: { id: string; company_name: string; inn: string };
  manager: { id: string; full_name: string } | null;
  city: { id: string; name: string };
  address: string;
  contact_name: string;
  contact_phone: string;
  payment_method_label: string;
  desired_delivery_date: string;
  is_urgent: boolean;
  client_comment: string | null;
  manager_comment: string | null;
  cancel_reason: string | null;
  can_edit: boolean;
  can_confirm: boolean;
  can_cancel: boolean;
  can_deliver: boolean;
  can_assign_manager: boolean;
  items_count: number;
  total_qty: number;
  items: Array<{
    id: string;
    product_name: string;
    product_sku: string;
    package_info: string | null;
    sale_unit: string;
    qty: number;
    image_url?: string | null;
  }>;
  status_history: Array<{
    id: string;
    from_status_label: string | null;
    to_status_label: string;
    comment: string | null;
    created_at: string;
  }>;
};

type ManagerItem = { id: string; full_name: string; email: string };

function format_datetime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function format_date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function StaffOrderDetail({ order_id }: { order_id: string }) {
  const [order, set_order] = useState<StaffOrder | null>(null);
  const [managers, set_managers] = useState<ManagerItem[]>([]);
  const [is_director, set_is_director] = useState(false);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);

  const [confirm_open, set_confirm_open] = useState(false);
  const [confirm_comment, set_confirm_comment] = useState("");
  const [cancel_open, set_cancel_open] = useState(false);
  const [cancel_reason, set_cancel_reason] = useState("");
  const [cancel_comment, set_cancel_comment] = useState("");
  const [deliver_open, set_deliver_open] = useState(false);
  const [deliver_comment, set_deliver_comment] = useState("");
  const [assign_manager_id, set_assign_manager_id] = useState("");

  async function load() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/orders/${order_id}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить заказ");
      }
      set_order(data.order);
      set_managers(data.managers ?? []);
      set_is_director(Boolean(data.is_director));
      set_assign_manager_id(data.order.manager?.id ?? "");
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
      set_order(null);
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order_id]);

  async function post_action(
    path: string,
    body: Record<string, unknown>,
    close: () => void,
  ) {
    if (busy) return;
    set_busy(true);
    set_error(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось выполнить действие");
      }
      set_order(data.order);
      set_message(data.message ?? "Готово");
      close();
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      set_busy(false);
    }
  }

  async function assign_manager() {
    if (busy) return;
    set_busy(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/orders/${order_id}/manager`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manager_id: assign_manager_id ? assign_manager_id : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось назначить менеджера");
      }
      set_order(data.order);
      set_message(data.message ?? "Менеджер заказа обновлён");
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      set_busy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-white"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/staff/orders" className="text-sm text-teal-800 underline">
            ← К заказам
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{order.number}</h1>
          <p className="text-sm text-slate-700">
            {order.status_label}
            {order.is_urgent ? (
              <span className="ml-2 text-amber-700">Срочный</span>
            ) : null}
          </p>
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">
          {order.can_edit ? (
            <Link
              href={`/staff/orders/${order.id}/edit`}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Редактировать
            </Link>
          ) : null}
          {order.can_confirm ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => set_confirm_open(true)}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Подтвердить заказ
            </button>
          ) : null}
          {order.can_deliver ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => set_deliver_open(true)}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Отметить доставленным
            </button>
          ) : null}
          {order.can_cancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => set_cancel_open(true)}
              className="rounded-md border border-red-200 px-4 py-2 text-sm text-red-700 disabled:opacity-40"
            >
              Отменить заказ
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {confirm_open ? (
        <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="font-medium">Подтвердить заказ?</p>
          <textarea
            value={confirm_comment}
            onChange={(e) => set_confirm_comment(e.target.value)}
            placeholder="Внутренний комментарий (необязательно)"
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={2}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void post_action(
                  `/api/v1/staff/orders/${order_id}/confirm`,
                  {
                    manager_comment: confirm_comment.trim()
                      ? confirm_comment.trim()
                      : null,
                  },
                  () => set_confirm_open(false),
                )
              }
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
            >
              {busy ? "Сохраняем…" : "Подтвердить"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => set_confirm_open(false)}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {cancel_open ? (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-900">Отменить заказ?</p>
          <label className="block text-sm">
            <span className="mb-1 block">Причина отмены</span>
            <textarea
              required
              value={cancel_reason}
              onChange={(e) => set_cancel_reason(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
              rows={2}
              disabled={busy}
            />
          </label>
          <textarea
            value={cancel_comment}
            onChange={(e) => set_cancel_comment(e.target.value)}
            placeholder="Внутренний комментарий (необязательно)"
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={2}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !cancel_reason.trim()}
              onClick={() =>
                void post_action(
                  `/api/v1/staff/orders/${order_id}/cancel`,
                  {
                    reason: cancel_reason.trim(),
                    manager_comment: cancel_comment.trim()
                      ? cancel_comment.trim()
                      : null,
                  },
                  () => set_cancel_open(false),
                )
              }
              className="rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? "Отменяем…" : "Отменить заказ"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => set_cancel_open(false)}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      {deliver_open ? (
        <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="font-medium">
            Подтвердить, что заказ доставлен клиенту?
          </p>
          <textarea
            value={deliver_comment}
            onChange={(e) => set_deliver_comment(e.target.value)}
            placeholder="Внутренний комментарий (необязательно)"
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={2}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void post_action(
                  `/api/v1/staff/orders/${order_id}/deliver`,
                  {
                    manager_comment: deliver_comment.trim()
                      ? deliver_comment.trim()
                      : null,
                  },
                  () => set_deliver_open(false),
                )
              }
              className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
            >
              {busy ? "Сохраняем…" : "Да, доставлен"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => set_deliver_open(false)}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Данные заказа</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Создан</dt>
              <dd>{format_datetime(order.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Клиент</dt>
              <dd className="text-right">{order.client.company_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">ИНН</dt>
              <dd>{order.client.inn}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Менеджер</dt>
              <dd>{order.manager?.full_name || "Не назначен"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Город</dt>
              <dd>{order.city.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Адрес</dt>
              <dd className="text-right">{order.address}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Контакт</dt>
              <dd className="text-right">{order.contact_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Телефон</dt>
              <dd>{order.contact_phone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Оплата</dt>
              <dd className="text-right">{order.payment_method_label}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Доставка</dt>
              <dd>{format_date(order.desired_delivery_date)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Позиции / единицы</dt>
              <dd>
                {order.items_count} / {order.total_qty}
              </dd>
            </div>
          </dl>
          {order.client_comment ? (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
              Комментарий клиента: {order.client_comment}
            </p>
          ) : null}
          {order.manager_comment ? (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm">
              Внутренний комментарий: {order.manager_comment}
            </p>
          ) : null}
          {order.cancel_reason ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              Причина отмены: {order.cancel_reason}
            </p>
          ) : null}

          {(is_director || order.can_assign_manager) &&
          (is_director || !order.manager) ? (
            <div className="mt-4 space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Назначение менеджера</p>
              {is_director ? (
                <select
                  value={assign_manager_id}
                  onChange={(e) => set_assign_manager_id(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  disabled={busy}
                >
                  <option value="">Без менеджера</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-600">
                  Можно закрепить заказ за собой
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    if (is_director) {
                      await assign_manager();
                      return;
                    }
                    set_busy(true);
                    set_error(null);
                    try {
                      const me = await fetch("/api/v1/auth/me").then((r) =>
                        r.json(),
                      );
                      const response = await fetch(
                        `/api/v1/staff/orders/${order_id}/manager`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            manager_id: me.user.id,
                          }),
                        },
                      );
                      const data = await response.json();
                      if (!response.ok) {
                        throw new Error(
                          data?.error?.message ??
                            "Не удалось закрепить заказ",
                        );
                      }
                      set_order(data.order);
                      set_message(data.message);
                    } catch (err) {
                      set_error(err instanceof Error ? err.message : "Ошибка");
                    } finally {
                      set_busy(false);
                    }
                  })();
                }}
                className="rounded-md border px-3 py-2 text-sm"
              >
                {is_director ? "Сохранить менеджера" : "Закрепить за мной"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">История статусов</h2>
          <ul className="mt-3 space-y-3">
            {order.status_history.map((row) => (
              <li key={row.id} className="border-b pb-3 text-sm last:border-0">
                <p className="font-medium">
                  {row.from_status_label
                    ? `${row.from_status_label} → ${row.to_status_label}`
                    : row.to_status_label}
                </p>
                <p className="text-xs text-slate-500">
                  {format_datetime(row.created_at)}
                </p>
                {row.comment ? (
                  <p className="mt-1 text-slate-600">{row.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Состав заказа</h2>
        <ul className="mt-3 space-y-3 md:hidden">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 border-b pb-3 text-sm last:border-0"
            >
              <ProductImage
                src={item.image_url}
                alt={item.product_name}
                className="h-14 w-14 shrink-0"
              />
              <div>
                <p className="font-medium">{item.product_name}</p>
                <p className="text-xs text-slate-500">{item.product_sku}</p>
                <p className="text-xs text-slate-600">{item.package_info || "—"}</p>
                <p>
                  {item.qty} {item.sale_unit}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Фото</th>
                <th className="px-3 py-2">Товар</th>
                <th className="px-3 py-2">Артикул</th>
                <th className="px-3 py-2">Упаковка</th>
                <th className="px-3 py-2">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <ProductImage
                      src={item.image_url}
                      alt={item.product_name}
                      className="h-12 w-12"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{item.product_name}</td>
                  <td className="px-3 py-2">{item.product_sku}</td>
                  <td className="px-3 py-2">{item.package_info || "—"}</td>
                  <td className="px-3 py-2">
                    {item.qty} {item.sale_unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-white p-3 lg:hidden">
        {order.can_edit ? (
          <Link
            href={`/staff/orders/${order.id}/edit`}
            className="flex-1 rounded-md border px-3 py-3 text-center text-sm"
          >
            Изменить
          </Link>
        ) : null}
        {order.can_confirm ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => set_confirm_open(true)}
            className="flex-1 rounded-md bg-teal-700 px-3 py-3 text-sm text-white"
          >
            Подтвердить
          </button>
        ) : null}
        {order.can_deliver ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => set_deliver_open(true)}
            className="flex-1 rounded-md bg-teal-700 px-3 py-3 text-sm text-white"
          >
            Доставлен
          </button>
        ) : null}
        {order.can_cancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => set_cancel_open(true)}
            className="flex-1 rounded-md border border-red-200 px-3 py-3 text-sm text-red-700"
          >
            Отменить
          </button>
        ) : null}
      </div>
    </div>
  );
}
