import type { Prisma } from "@prisma/client";
import {
  has_role,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

export function can_view_all_orders(payload: AuthUserPayload): boolean {
  if (has_role(payload.user.roles, "director")) {
    return true;
  }
  return (
    has_role(payload.user.roles, "manager") &&
    Boolean(payload.employee?.can_view_all_clients)
  );
}

/** Prisma where for staff order list scoping. */
export function staff_orders_scope_where(
  payload: AuthUserPayload,
): Prisma.ordersWhereInput {
  if (can_view_all_orders(payload)) {
    return {};
  }

  const user_id = payload.user.id;
  return {
    OR: [{ manager_id: user_id }, { client: { manager_id: user_id } }],
  };
}

export function staff_can_access_order(
  payload: AuthUserPayload,
  order: {
    manager_id: string | null;
    client: { manager_id: string | null };
  },
): boolean {
  if (!is_staff(payload.user.roles)) {
    return false;
  }
  if (can_view_all_orders(payload)) {
    return true;
  }
  const user_id = payload.user.id;
  return (
    order.manager_id === user_id || order.client.manager_id === user_id
  );
}

export function assert_staff_user(payload: AuthUserPayload) {
  if (!is_staff(payload.user.roles)) {
    throw new Error("forbidden_staff");
  }
}
