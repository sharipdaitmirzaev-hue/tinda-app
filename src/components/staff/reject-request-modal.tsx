"use client";

import { FormEvent, useState } from "react";

type Props = {
  open: boolean;
  loading: boolean;
  on_close: () => void;
  on_submit: (reason: string) => Promise<void>;
};

export function RejectRequestModal({
  open,
  loading,
  on_close,
  on_submit,
}: Props) {
  const [reason, set_reason] = useState("");
  const [error, set_error] = useState<string | null>(null);

  if (!open) return null;

  async function handle_submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      set_error("Укажите причину отклонения");
      return;
    }
    set_error(null);
    await on_submit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-title"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
      >
        <h2 id="reject-title" className="text-lg font-semibold text-slate-900">
          Отклонить заявку
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Укажите причину. Клиент увидит её на экране ожидания.
        </p>
        <form onSubmit={handle_submit} className="mt-4 space-y-3">
          <textarea
            value={reason}
            onChange={(e) => set_reason(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Причина отклонения"
            required
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={on_close}
              disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-60"
            >
              {loading ? "Отклонение…" : "Отклонить заявку"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
