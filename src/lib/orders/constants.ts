export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  delivered: "Доставлен",
  cancelled: "Отменён",
};

export function get_order_status_label(status: string): string {
  if (status in ORDER_STATUS_LABELS) {
    return ORDER_STATUS_LABELS[status as OrderStatus];
  }
  return status;
}
