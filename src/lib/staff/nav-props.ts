import { can_edit_catalog, type AuthUserPayload } from "@/lib/access";

export function staff_nav_props(auth: AuthUserPayload) {
  return {
    full_name: auth.user.full_name,
    roles: auth.user.roles,
    can_edit_catalog: can_edit_catalog(auth),
  };
}
