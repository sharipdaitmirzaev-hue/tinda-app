import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { ClientHeader } from "@/components/client/client-header";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { resolve_client_shop_access } from "@/lib/access";

export default async function ProfilePage() {
  const auth = await get_current_auth_payload();
  const access = resolve_client_shop_access(auth);
  if (!access.allow) {
    redirect(access.redirect_to);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientHeader full_name={auth!.user.full_name} />
      <main className="mx-auto max-w-lg px-4 py-8 pb-24">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">Профиль</h1>
          <p className="mt-2 text-slate-600">{auth!.user.full_name}</p>
          <p className="text-sm text-slate-500">{auth!.user.email}</p>
          <p className="mt-2 text-sm text-slate-600">
            Компания: {auth!.client?.company_name}
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Расширенный профиль появится позже. Сейчас доступен выход из
            аккаунта.
          </p>
          <div className="mt-4">
            <LogoutButton />
          </div>
        </div>
      </main>
      <ClientBottomNav />
    </div>
  );
}
