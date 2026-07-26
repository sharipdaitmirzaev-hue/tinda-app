import { redirect } from "next/navigation";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import {
  get_post_auth_path,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

export async function require_auth(): Promise<AuthUserPayload> {
  const payload = await get_current_auth_payload();
  if (!payload) {
    redirect("/login");
  }
  return payload;
}

export async function require_guest(): Promise<void> {
  const payload = await get_current_auth_payload();
  if (payload) {
    redirect(get_post_auth_path(payload));
  }
}

export async function require_staff(): Promise<AuthUserPayload> {
  const payload = await require_auth();
  if (!is_staff(payload.user.roles)) {
    redirect(get_post_auth_path(payload));
  }
  return payload;
}

export async function require_client_area(): Promise<AuthUserPayload> {
  const payload = await require_auth();
  if (is_staff(payload.user.roles)) {
    redirect("/staff/orders");
  }
  if (!payload.client) {
    redirect("/login");
  }
  if (payload.client.status !== "approved") {
    redirect("/pending");
  }
  return payload;
}

export async function require_pending_client(): Promise<AuthUserPayload> {
  const payload = await require_auth();
  if (is_staff(payload.user.roles)) {
    redirect("/staff/orders");
  }
  if (!payload.client) {
    redirect("/login");
  }
  if (payload.client.status === "approved") {
    redirect("/catalog");
  }
  return payload;
}
