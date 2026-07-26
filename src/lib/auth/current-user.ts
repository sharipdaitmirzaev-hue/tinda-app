import { prisma } from "@/lib/db";
import type { AuthUserPayload, RoleCode } from "@/lib/access";
import { get_session_user_id } from "@/lib/auth/session";

export async function build_auth_payload(
  user_id: string,
): Promise<AuthUserPayload | null> {
  const user = await prisma.users.findUnique({
    where: { id: user_id },
    include: {
      user_roles: { include: { role: true } },
      client: true,
      employee_profile: true,
    },
  });

  if (!user || !user.is_active) {
    return null;
  }

  const roles = user.user_roles.map((item) => item.role.code) as RoleCode[];

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles,
    },
    client: user.client
      ? {
          id: user.client.id,
          status: user.client.status,
          company_name: user.client.company_name,
        }
      : null,
    employee: user.employee_profile
      ? {
          can_view_all_clients: user.employee_profile.can_view_all_clients,
          can_edit_catalog: user.employee_profile.can_edit_catalog,
        }
      : null,
  };
}

export async function get_current_auth_payload(): Promise<AuthUserPayload | null> {
  const user_id = await get_session_user_id();
  if (!user_id) {
    return null;
  }
  return build_auth_payload(user_id);
}
