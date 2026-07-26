export type RoleCode = "client" | "manager" | "director";

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

export function has_role(roles: string[], role: RoleCode): boolean {
  return roles.includes(role);
}

export function is_staff(roles: string[]): boolean {
  return has_role(roles, "manager") || has_role(roles, "director");
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
