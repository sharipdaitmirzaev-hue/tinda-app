import { AppError } from "@/lib/http/errors";

export type RoleCode = "client" | "manager" | "director";

export type ClientStatus = "pending" | "approved" | "rejected" | "blocked";

export type AuthClientSummary = {
  id: string;
  status: string;
  company_name: string;
} | null;

export type AuthEmployeeSummary = {
  can_view_all_clients: boolean;
  can_edit_catalog: boolean;
} | null;

export type AuthUserPayload = {
  user: {
    id: string;
    email: string;
    full_name: string;
    roles: RoleCode[];
  };
  client: AuthClientSummary;
  employee: AuthEmployeeSummary;
};

export type AccessDecision =
  | { allow: true }
  | { allow: false; redirect_to: string };

export function has_role(roles: string[], role: RoleCode): boolean {
  return roles.includes(role);
}

export function is_staff(roles: string[]): boolean {
  return has_role(roles, "manager") || has_role(roles, "director");
}

export function is_director(payload: AuthUserPayload): boolean {
  return has_role(payload.user.roles, "director");
}

export function can_edit_catalog(payload: AuthUserPayload): boolean {
  if (is_director(payload)) {
    return true;
  }
  return (
    has_role(payload.user.roles, "manager") &&
    Boolean(payload.employee?.can_edit_catalog)
  );
}

/** Visibility expansion for clients/orders — not a director privilege. */
export function can_view_all_clients(payload: AuthUserPayload): boolean {
  if (is_director(payload)) {
    return true;
  }
  return (
    has_role(payload.user.roles, "manager") &&
    Boolean(payload.employee?.can_view_all_clients)
  );
}

export function is_client_status(status: string): status is ClientStatus {
  return (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "blocked"
  );
}

/** Post-login / post-register destination path. */
export function get_post_auth_path(payload: AuthUserPayload): string {
  if (is_staff(payload.user.roles)) {
    return "/staff/orders";
  }

  if (payload.client) {
    if (payload.client.status === "approved") {
      return "/catalog";
    }
    return "/pending";
  }

  return "/login";
}

export function can_place_orders(payload: AuthUserPayload): boolean {
  return (
    !is_staff(payload.user.roles) &&
    has_role(payload.user.roles, "client") &&
    payload.client?.status === "approved"
  );
}

/** Approved clients see wholesale prices in the public catalog API/UI. */
export function can_see_client_prices(payload: AuthUserPayload | null): boolean {
  if (!payload) return false;
  return can_place_orders(payload);
}

export function can_access_client_shop(payload: AuthUserPayload): boolean {
  return can_place_orders(payload);
}

/** Whether staff may access a client record by manager assignment. */
export function can_access_client(
  payload: AuthUserPayload,
  client: { manager_id: string | null },
): boolean {
  if (!is_staff(payload.user.roles)) {
    return false;
  }
  if (can_view_all_clients(payload)) {
    return true;
  }
  return client.manager_id === payload.user.id;
}

/**
 * Public catalog pages (/catalog, product detail).
 * Guests and any client status may browse.
 * Catalog editors (director / manager with can_edit_catalog) may browse
 * public cards to jump into staff edit. Other staff stay in staff area.
 */
export function resolve_public_catalog_access(
  payload: AuthUserPayload | null,
): AccessDecision {
  if (payload && is_staff(payload.user.roles)) {
    if (can_edit_catalog(payload)) {
      return { allow: true };
    }
    return { allow: false, redirect_to: "/staff/orders" };
  }
  return { allow: true };
}

/** /cart, /orders, /checkout, /profile — only approved clients. */
export function resolve_client_shop_access(
  payload: AuthUserPayload | null,
): AccessDecision {
  if (!payload) {
    return { allow: false, redirect_to: "/login" };
  }
  if (is_staff(payload.user.roles)) {
    return { allow: false, redirect_to: "/staff/orders" };
  }
  if (!payload.client) {
    return { allow: false, redirect_to: "/login" };
  }
  if (payload.client.status === "approved") {
    return { allow: true };
  }
  return { allow: false, redirect_to: "/pending" };
}

/** /pending — waiting / rejected / blocked screen */
export function resolve_pending_page_access(
  payload: AuthUserPayload | null,
): AccessDecision {
  if (!payload) {
    return { allow: false, redirect_to: "/login" };
  }
  if (is_staff(payload.user.roles)) {
    return { allow: false, redirect_to: "/staff/orders" };
  }
  if (!payload.client) {
    return { allow: false, redirect_to: "/login" };
  }
  if (payload.client.status === "approved") {
    return { allow: false, redirect_to: "/catalog" };
  }
  return { allow: true };
}

/** /staff/* */
export function resolve_staff_access(
  payload: AuthUserPayload | null,
): AccessDecision {
  if (!payload) {
    return { allow: false, redirect_to: "/login" };
  }
  if (!is_staff(payload.user.roles)) {
    return { allow: false, redirect_to: get_post_auth_path(payload) };
  }
  return { allow: true };
}

/** /staff/categories, /staff/products */
export function resolve_catalog_editor_access(
  payload: AuthUserPayload | null,
): AccessDecision {
  const staff = resolve_staff_access(payload);
  if (!staff.allow) {
    return staff;
  }
  if (!payload || !can_edit_catalog(payload)) {
    return { allow: false, redirect_to: "/staff/orders" };
  }
  return { allow: true };
}

export function get_support_contacts(settings: {
  support_email?: unknown;
  support_phone?: unknown;
}): { support_email: string | null; support_phone: string | null } {
  return {
    support_email:
      typeof settings.support_email === "string" ? settings.support_email : null,
    support_phone:
      typeof settings.support_phone === "string" ? settings.support_phone : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Shared server asserts (API + services). UI hiding is not a security control. */
/* -------------------------------------------------------------------------- */

export function assert_authenticated(
  payload: AuthUserPayload | null,
): AuthUserPayload {
  if (!payload) {
    throw new AppError(401, "unauthorized", "Требуется вход в систему");
  }
  return payload;
}

export function assert_staff(payload: AuthUserPayload): void {
  if (!is_staff(payload.user.roles)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}

export function assert_director(payload: AuthUserPayload): void {
  if (!is_director(payload)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}

export function assert_catalog_editor(payload: AuthUserPayload): void {
  if (!is_staff(payload.user.roles) || !can_edit_catalog(payload)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}

/**
 * Approved client for shop APIs (catalog/cart/orders).
 * Staff are always rejected even if they also have a client profile.
 */
export function assert_approved_client(payload: AuthUserPayload): string {
  if (is_staff(payload.user.roles)) {
    throw new AppError(
      403,
      "forbidden",
      "Клиентский раздел доступен только клиентам",
    );
  }
  if (!can_place_orders(payload) || !payload.client) {
    throw new AppError(
      403,
      "forbidden",
      "Доступно после подтверждения заявки",
    );
  }
  return payload.client.id;
}

export function assert_client_profile(payload: AuthUserPayload): string {
  if (is_staff(payload.user.roles) || !payload.client) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
  return payload.client.id;
}
