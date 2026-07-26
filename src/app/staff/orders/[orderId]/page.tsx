import { StaffNav } from "@/components/staff/staff-nav";
import { StaffOrderDetail } from "@/components/staff/staff-order-detail";
import { require_staff } from "@/lib/auth/require-auth";
import { staff_nav_props } from "@/lib/staff/nav-props";

type Props = { params: Promise<{ orderId: string }> };

export default async function StaffOrderDetailPage({ params }: Props) {
  const auth = await require_staff();
  const { orderId } = await params;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <StaffNav {...staff_nav_props(auth)} />
        <StaffOrderDetail order_id={orderId} />
      </div>
    </main>
  );
}
