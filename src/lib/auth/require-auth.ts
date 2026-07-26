import { redirect } from "next/navigation";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import {
  get_post_auth_path,
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

/** Catalog, cart, orders — only approved clients. */
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
