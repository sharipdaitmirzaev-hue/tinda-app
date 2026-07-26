"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshStatusButton() {
  const router = useRouter();
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function on_refresh() {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch("/api/v1/client/registration-status");
      const data = await response.json();
      if (!response.ok) {
        set_error(data?.error?.message ?? "Не удалось обновить статус");
        return;
      }
      if (data.redirect_to && data.redirect_to !== "/pending") {
        router.replace(data.redirect_to);
      } else {
        router.refresh();
      }
    } catch {
      set_error("Нет соединения. Проверьте интернет.");
    } finally {
      set_loading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={on_refresh}
        disabled={loading}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-60"
      >
        {loading ? "Обновление…" : "Обновить статус"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
