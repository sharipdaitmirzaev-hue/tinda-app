import { notFound } from "next/navigation";
import { StaffNav } from "@/components/staff/staff-nav";
import { RegistrationRequestDetail } from "@/components/staff/registration-request-detail";
import { require_staff } from "@/lib/auth/require-auth";
import { AppError } from "@/lib/http/errors";
import { get_registration_request } from "@/lib/services/registration-requests.service";
import { staff_nav_props } from "@/lib/staff/nav-props";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function RegistrationRequestDetailPage({
  params,
}: PageProps) {
  const auth = await require_staff();
  const { clientId } = await params;

  let data;
  try {
    data = await get_registration_request(auth, clientId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <StaffNav {...staff_nav_props(auth)} />
        <RegistrationRequestDetail
          initial_request={data.request}
          managers={data.managers}
          can_assign_manager={data.can_assign_manager}
        />
      </div>
    </main>
  );
}
