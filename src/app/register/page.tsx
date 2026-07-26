import { RegisterForm } from "@/components/auth/register-form";
import { require_guest } from "@/lib/auth/require-auth";

export default async function RegisterPage() {
  await require_guest();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-teal-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
          ТИНДА
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Регистрация клиента
        </h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">
          После отправки заявки менеджер проверит данные и откроет доступ к
          заказам.
        </p>
        <RegisterForm />
      </div>
    </main>
  );
}
