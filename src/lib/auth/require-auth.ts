import { redirect } from "next/navigation";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import {
  get_post_auth_path,
  is_director,
  resolve_catalog_editor_access,
  resolve_client_shop_access,
  resolve_pending_page_access,
  resolve_staff_access,
  type AuthUserPayload,
} from "@/lib/access";

function apply_decision(
  decision: { allow: true } | { allow: false; redirect_to: string },
  payload: AuthUserPayload | null,
): AuthUserPayload {
  if (!decision.allow) {
    redirect(decision.redirect_to);
  }
  if (!payload) {
    redirect("/login");
  }
  return payload;
}

/** Page guard: any authenticated active user. */
export async function require_authenticated_user(): Promise<AuthUserPayload> {
  return require_auth();
}

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
  const payload = await get_current_auth_payload();
  return apply_decision(resolve_staff_access(payload), payload);
}

/** Alias: approved client shop area. */
export async function require_approved_client(): Promise<AuthUserPayload> {
  return require_client_area();
}

/** Any client profile (pending/approved/rejected/blocked). Staff redirected away. */
export async function require_client(): Promise<AuthUserPayload> {
  const payload = await get_current_auth_payload();
  if (!payload) {
    redirect("/login");
  }
  const staff = resolve_staff_access(payload);
  if (staff.allow) {
    redirect("/staff/orders");
  }
  if (!payload.client) {
    redirect("/login");
  }
  return payload;
}

/** Catalog, cart, orders, checkout — only approved clients. */
export async function require_client_area(): Promise<AuthUserPayload> {
  const payload = await get_current_auth_payload();
  return apply_decision(resolve_client_shop_access(payload), payload);
}

/** Pending / rejected / blocked status screen. */
export async function require_pending_client(): Promise<AuthUserPayload> {
  const payload = await get_current_auth_payload();
  return apply_decision(resolve_pending_page_access(payload), payload);
}

/** Staff catalog editors: director or manager with can_edit_catalog. */
export async function require_catalog_editor(): Promise<AuthUserPayload> {
  const payload = await get_current_auth_payload();
  return apply_decision(resolve_catalog_editor_access(payload), payload);
}

export async function require_director(): Promise<AuthUserPayload> {
  const payload = await require_staff();
  if (!is_director(payload)) {
    redirect("/staff/orders");
  }
  return payload;
}
