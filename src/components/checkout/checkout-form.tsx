"use client";

import {
  UI_CLOSE,
  UI_URGENT_ORDER,
} from "@/lib/i18n/ui-copy";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/catalog/constants";
import { today_date_key } from "@/lib/dates";
import type { SerializedCart } from "@/lib/cart/types";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validators/orders";
import { mark_server_cart_empty } from "@/lib/cart/server-cart-store";

type Prefill = {
  address: string;
  contact_name: string;
  contact_phone: string;
};

type Props = {
  cart: SerializedCart;
  prefill: Prefill;
};

function new_idempotency_key() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function CheckoutForm({ cart, prefill }: Props) {
  const router = useRouter();
  const min_date = useMemo(() => today_date_key(), []);
  const [address, set_address] = useState(prefill.address);
  const [desired_delivery_date, set_desired_delivery_date] = useState(min_date);
  const [contact_name, set_contact_name] = useState(prefill.contact_name);
  const [contact_phone, set_contact_phone] = useState(prefill.contact_phone);
  const [payment_method, set_payment_method] = useState<PaymentMethod | "">(
    "",
  );
  const [is_urgent, set_is_urgent] = useState(false);
  const [client_comment, set_client_comment] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [idempotency_key] = useState(() => new_idempotency_key());

  async function on_submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    set_error(null);
    set_submitting(true);
    try {
      const response = await fetch("/api/v1/orders", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotency_key,
        },
        body: JSON.stringify({
          address,
          desired_delivery_date,
          contact_name,
          contact_phone,
          payment_method,
          is_urgent,
          client_comment: client_comment.trim() ? client_comment.trim() : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.error?.message ?? "Не удалось отправить заказ. Попробуйте ещё раз",
        );
      }
      mark_server_cart_empty();
      router.replace(`/checkout/success/${data.order.id}`);
    } catch (err) {
      set_error(
        err instanceof Error
          ? err.message
          : "Не удалось отправить заказ. Попробуйте ещё раз",
      );
      set_submitting(false);
    }
  }

  return (
    <form
      onSubmit={on_submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
    >
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Оформление заказа
        </h1>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p>{error}</p>
            <button
              type="button"
              className="mt-2 underline"
              onClick={() => set_error(null)}
            >
              {UI_CLOSE}
            </button>
          </div>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-800">Адрес доставки</span>
          <textarea
            required
            rows={3}
            value={address}
            disabled={submitting}
            onChange={(e) => set_address(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
          />
          <span className="text-xs text-slate-500">
            Адрес меняется только для этого заказа и не обновляет профиль.
          </span>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-800">
            Желаемая дата доставки
          </span>
          <input
            type="date"
            required
            min={min_date}
            value={desired_delivery_date}
            disabled={submitting}
            onChange={(e) => set_desired_delivery_date(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-800">Контактное лицо</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={255}
            value={contact_name}
            disabled={submitting}
            onChange={(e) => set_contact_name(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-800">Телефон</span>
          <input
            type="tel"
            required
            value={contact_phone}
            disabled={submitting}
            onChange={(e) => set_contact_phone(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
            placeholder="+7…"
          />
        </label>

        <fieldset className="space-y-2 text-sm" disabled={submitting}>
          <legend className="font-medium text-slate-800">Способ оплаты</legend>
          <div className="space-y-2">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2"
              >
                <input
                  type="radio"
                  name="payment_method"
                  required
                  value={method}
                  checked={payment_method === method}
                  onChange={() => set_payment_method(method)}
                  className="mt-1"
                />
                <span>{PAYMENT_METHOD_LABELS[method]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={is_urgent}
            disabled={submitting}
            onChange={(e) => set_is_urgent(e.target.checked)}
          />
          <span>{UI_URGENT_ORDER}</span>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-800">
            Комментарий к заказу
          </span>
          <textarea
            rows={3}
            maxLength={2000}
            value={client_comment}
            disabled={submitting}
            onChange={(e) => set_client_comment(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
            placeholder="Необязательно"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-teal-700 px-4 py-3 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 lg:w-auto"
        >
          {submitting ? "Отправляем заказ…" : "Отправить заказ"}
        </button>
      </section>

      <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Состав заказа</h2>
          <Link href="/cart" className="text-sm text-teal-800 underline">
            Изменить корзину
          </Link>
        </div>

        <ul className="space-y-3">
          {cart.items.map((item) => {
            const availability_label =
              AVAILABILITY_LABELS[
                item.product.availability as Availability
              ] ?? item.product.availability;
            return (
              <li
                key={item.product_id}
                className="flex gap-3 border-b border-slate-100 pb-3 last:border-0"
              >
                <ProductImage
                  src={item.product.image_url}
                  alt={item.product.name}
                  className="h-16 w-16 shrink-0"
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">
                    {item.product.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Артикул: {item.product.sku}
                  </p>
                  <p className="text-xs text-slate-600">
                    {[item.product.volume_text, item.product.package_type]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  <p className="text-xs text-slate-700">
                    Количество: {item.qty} {item.product.sale_unit}
                  </p>
                  <p className="text-xs text-teal-800">{availability_label}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <dl className="space-y-1 text-sm text-slate-700">
          <div className="flex justify-between">
            <dt>Позиций</dt>
            <dd>{cart.items_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Всего единиц</dt>
            <dd>{cart.total_qty}</dd>
          </div>
        </dl>
      </aside>
    </form>
  );
}
