import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-slate-100 to-teal-50 px-4 py-12 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-teal-800">
        ТИНДА
      </p>
      <h1 className="mt-3 max-w-sm text-xl font-semibold text-slate-900">
        Нет подключения к интернету
      </h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">
        Проверьте сеть и попробуйте снова.
      </p>
      <Link href="/" className="ui-btn-primary mt-8">
        Повторить
      </Link>
    </main>
  );
}
