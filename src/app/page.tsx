export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-sm uppercase tracking-wide text-slate-500">ТИНДА</p>
        <h1 className="text-3xl font-semibold">Оптовое приложение — Э1</h1>
        <p className="text-slate-600">
          Выполнены шаги Э1.0 (каркас Next.js) и Э1.1 (схема БД Prisma + seed).
          Интерфейс входа и каталога появится на следующих шагах.
        </p>
        <p className="text-sm text-slate-500">
          Проверка API:{" "}
          <a className="underline" href="/api/v1/health">
            /api/v1/health
          </a>
        </p>
      </div>
    </main>
  );
}
