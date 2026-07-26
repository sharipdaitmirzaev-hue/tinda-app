import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="ui-card max-w-md p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
          ТИНДА
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">
          Недостаточно прав
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          У вашей учётной записи нет доступа к этому разделу.
        </p>
        <Link href="/" className="ui-btn-primary mt-5 inline-flex">
          На главную
        </Link>
      </div>
    </main>
  );
}
