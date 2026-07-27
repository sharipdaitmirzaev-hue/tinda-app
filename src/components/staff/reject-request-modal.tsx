"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

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
  const dialog_ref = useRef<HTMLDivElement>(null);
  const textarea_ref = useRef<HTMLTextAreaElement>(null);
  const reason_id = useId();
  const error_id = useId();

  useEffect(() => {
    if (!open) return;
    set_reason("");
    set_error(null);
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => textarea_ref.current?.focus(), 0);

    function on_key_down(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        event.preventDefault();
        on_close();
        return;
      }
      if (event.key !== "Tab" || !dialog_ref.current) return;
      const focusable = dialog_ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", on_key_down);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", on_key_down);
      previous?.focus();
    };
  }, [open, loading, on_close]);

  if (!open) return null;

  async function handle_submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      set_error("Укажите причину отклонения");
      textarea_ref.current?.focus();
      return;
    }
    set_error(null);
    await on_submit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={dialog_ref}
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
          <label htmlFor={reason_id} className="ui-label">
            Причина отклонения <span className="text-red-700">*</span>
          </label>
          <textarea
            id={reason_id}
            ref={textarea_ref}
            value={reason}
            onChange={(e) => set_reason(e.target.value)}
            rows={4}
            className="ui-input"
            placeholder="Кратко опишите причину"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? error_id : undefined}
          />
          {error ? (
            <p id={error_id} className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={on_close}
              disabled={loading}
              className="ui-btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="ui-btn bg-red-700 text-white hover:bg-red-800"
            >
              {loading ? "Отклонение…" : "Отклонить заявку"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
