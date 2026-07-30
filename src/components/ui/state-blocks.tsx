"use client";

import { UI_RETRY } from "@/lib/i18n/ui-copy";

export function LoadingBlock({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      <p className="text-sm text-slate-600">{label}</p>
    </div>
  );
}

export function EmptyBlock({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
      <p className="text-base font-medium text-slate-900">{title}</p>
      {description ? (
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBlock({
  message,
  on_retry,
}: {
  message: string;
  on_retry?: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      role="alert"
    >
      <p>{message}</p>
      {on_retry ? (
        <button
          type="button"
          onClick={on_retry}
          className="ui-btn-secondary mt-3"
        >
          {UI_RETRY}
        </button>
      ) : null}
    </div>
  );
}

export function SuccessBlock({ message }: { message: string }) {
  return (
    <p
      className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900"
      role="status"
      aria-live="polite"
    >
      {message}
    </p>
  );
}
