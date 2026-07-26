import { redirect } from "next/navigation";
import { get_post_auth_path } from "@/lib/access";
import { get_current_auth_payload } from "@/lib/auth/current-user";

export default async function HomePage() {
  const payload = await get_current_auth_payload();
  if (payload) {
    redirect(get_post_auth_path(payload));
  }
  redirect("/login");
}
