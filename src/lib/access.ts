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

export function can_edit_catalog(payload: AuthUserPayload): boolean {
  if (has_role(payload.user.roles, "director")) {
    return true;
  }
  return (
    has_role(payload.user.roles, "manager") &&
    Boolean(payload.employee?.can_edit_catalog)
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
    has_role(payload.user.roles, "client") &&
    payload.client?.status === "approved"
  );
}

export function can_access_client_shop(payload: AuthUserPayload): boolean {
  return can_place_orders(payload);
}

/** /catalog, /cart, /orders */
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
