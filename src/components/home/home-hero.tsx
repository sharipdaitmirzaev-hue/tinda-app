import Link from "next/link";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden border-b border-teal-900/10 bg-gradient-to-br from-teal-950 via-teal-900 to-slate-900 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(45,212,191,0.35), transparent 45%), radial-gradient(circle at 80% 0%, rgba(148,163,184,0.25), transparent 40%)",
        }}
        aria-hidden
      />
      <div className="ui-container relative flex min-h-[70vh] flex-col justify-end gap-6 py-16 md:min-h-[62vh] md:justify-center md:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-teal-200/90">
          ТИНДА
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          Оптовые напитки для магазинов и HoReCa
        </h1>
        <p className="max-w-xl text-base text-teal-50/85 md:text-lg">
          Подборка ходовых позиций и полный каталог воды, газировки, соков и
          энергии с доставкой под заказ.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/catalog"
            className="inline-flex min-h-11 items-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-teal-950 hover:bg-teal-50"
          >
            Открыть каталог
          </Link>
          <Link
            href="/register"
            className="inline-flex min-h-11 items-center rounded-md border border-white/30 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10"
          >
            Стать клиентом
          </Link>
        </div>
      </div>
    </section>
  );
}

export function HomeCatalogCta() {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="ui-container flex flex-col items-start justify-between gap-4 py-12 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">
            Весь ассортимент в каталоге
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Фильтры по категориям, брендам и объёмам — от воды до энергетики.
          </p>
        </div>
        <Link
          href="/catalog"
          className="inline-flex min-h-11 items-center rounded-md bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Перейти в каталог
        </Link>
      </div>
    </section>
  );
}
