"use client";

import {
  UI_OFFLINE_ERROR,
} from "@/lib/i18n/ui-copy";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [login, set_login] = useState("");
  const [password, set_password] = useState("");
  const [error, set_error] = useState<string | null>(null);
  const [loading, set_loading] = useState(false);

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    set_error(null);
    set_loading(true);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        set_error(data?.error?.message ?? "Не удалось выполнить вход");
        return;
      }

      router.replace(data.redirect_to ?? "/");
      router.refresh();
    } catch {
      set_error(UI_OFFLINE_ERROR);
    } finally {
      set_loading(false);
    }
  }

  return (
    <form onSubmit={on_submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="login">
          Эл. почта или телефон
        </label>
        <input
          id="login"
          name="login"
          autoComplete="username"
          value={login}
          onChange={(e) => set_login(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => set_password(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          required
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-white hover:bg-teal-800 disabled:opacity-60"
      >
        {loading ? "Вход…" : "Войти"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Нет доступа?{" "}
        <Link href="/register" className="text-teal-800 underline">
          Регистрация для клиентов
        </Link>
      </p>
    </form>
  );
}
