"use client";

import { useState } from "react";

type Props = {
  product_id: string;
  request_type: "interest" | "price_request";
  title: string;
  on_close: () => void;
};

export function ProductInterestForm({
  product_id,
  request_type,
  title,
  on_close,
}: Props) {
  const [qty, set_qty] = useState("12");
  const [comment, set_comment] = useState("");
  const [pending, set_pending] = useState(false);
  const [done_message, set_done_message] = useState<string | null>(null);
  const [error, set_error] = useState<string | null>(null);

  async function on_submit(e: React.FormEvent) {
    e.preventDefault();
    set_pending(true);
    set_error(null);
    try {
      const requested_qty = qty.trim() ? Number(qty) : null;
      const res = await fetch(
        `/api/v1/client/products/${product_id}/interest`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_type,
            requested_qty,
            comment: comment.trim() || null,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Не удалось отправить");
      }
      set_done_message(
        data.message ||
          (data.already_registered
            ? "Ваш запрос по этому товару уже зарегистрирован"
            : "Запрос отправлен. Менеджер свяжется с вами"),
      );
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      set_pending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            className="text-sm text-slate-500"
            onClick={on_close}
          >
            Закрыть
          </button>
        </div>

        {done_message ? (
          <p className="text-sm text-teal-800">{done_message}</p>
        ) : (
          <form className="space-y-3" onSubmit={on_submit}>
            <label className="block text-sm text-slate-700">
              Желаемое количество
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={qty}
                onChange={(e) => set_qty(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Комментарий
              <textarea
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                rows={3}
                value={comment}
                onChange={(e) => set_comment(e.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-800 disabled:bg-slate-300"
            >
              {pending ? "Отправка…" : "Отправить запрос"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
