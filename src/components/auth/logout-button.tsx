"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, set_loading] = useState(false);

  async function on_logout() {
    set_loading(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      set_loading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={on_logout}
      disabled={loading}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
    >
      {loading ? "Выход…" : "Выйти"}
    </button>
  );
}
