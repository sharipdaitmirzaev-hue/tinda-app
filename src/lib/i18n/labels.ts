import type { RoleCode, ClientStatus } from "@/lib/access";

export const ROLE_LABELS: Record<RoleCode, string> = {
  client: "Клиент",
  manager: "Менеджер",
  director: "Руководитель",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  pending: "На рассмотрении",
  approved: "Подтверждён",
  rejected: "Отклонён",
  blocked: "Заблокирован",
};

export function format_role_labels(roles: string[]): string {
  return roles
    .map((role) => ROLE_LABELS[role as RoleCode] ?? role)
    .join(", ");
}

export function client_status_label(status: string): string {
  if (status in CLIENT_STATUS_LABELS) {
    return CLIENT_STATUS_LABELS[status as ClientStatus];
  }
  return status;
}
