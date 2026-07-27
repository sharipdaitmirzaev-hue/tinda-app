import { LoginForm } from "@/components/auth/login-form";
import { require_guest } from "@/lib/auth/require-auth";

export default async function LoginPage() {
  await require_guest();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-teal-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md rounded-xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
          ТИНДА
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Вход</h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">
          Войдите как клиент, менеджер или руководитель.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
