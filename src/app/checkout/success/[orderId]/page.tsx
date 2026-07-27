import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { AppError } from "@/lib/http/errors";
import { require_client_area } from "@/lib/auth/require-auth";
import { get_order_success_details } from "@/lib/services/order.service";

type Props = { params: Promise<{ orderId: string }> };

export default async function CheckoutSuccessPage({ params }: Props) {
  const auth = await require_client_area();
  const { orderId } = await params;

  let details;
  try {
    details = await get_order_success_details(auth, orderId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const { order } = details;
  const created_at_label = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(order.created_at));

  const delivery_label = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${order.desired_delivery_date}T00:00:00.000Z`));

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]">
      <ClientHeader full_name={auth.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-8 pb-28">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Заказ отправлен
          </h1>
          <p className="mt-2 text-lg font-medium text-teal-900">
            {order.number}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Статус: <span className="font-medium">{order.status_label}</span>
          </p>

          <p className="mt-4 text-sm leading-relaxed text-slate-700">
            Менеджер проверит наличие товаров и свяжется с вами для подтверждения
            условий заказа
          </p>

          <dl className="mt-6 space-y-2 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt>Дата создания</dt>
              <dd className="text-right">{created_at_label}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Позиций</dt>
              <dd>{order.items_count}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Желаемая дата доставки</dt>
              <dd className="text-right">{delivery_label}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/catalog"
              className="rounded-md bg-teal-700 px-4 py-3 text-center text-sm font-medium text-white hover:bg-teal-800"
            >
              Вернуться в каталог
            </Link>
            <Link
              href="/orders"
              className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm text-slate-800"
            >
              Мои заказы
            </Link>
          </div>
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
