import type { Prisma } from "@prisma/client";
import {
  assert_staff,
  can_view_all_clients,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

export { assert_staff };

/** Alias kept for order-domain naming. */
export function can_view_all_orders(payload: AuthUserPayload): boolean {
  return can_view_all_clients(payload);
}

export function can_access_order(
  payload: AuthUserPayload,
  order: {
    manager_id: string | null;
    client: { manager_id: string | null };
  },
): boolean {
  return staff_can_access_order(payload, order);
}

/** Managing (edit/confirm/cancel/deliver) uses the same visibility scope in E1. */
export function can_manage_order(
  payload: AuthUserPayload,
  order: {
    manager_id: string | null;
    client: { manager_id: string | null };
  },
): boolean {
  return staff_can_access_order(payload, order);
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
