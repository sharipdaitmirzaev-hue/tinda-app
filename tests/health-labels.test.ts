import { describe, expect, it } from "vitest";
import { GET as health_get } from "@/app/api/v1/health/route";
import {
  CLIENT_STATUS_LABELS,
  ROLE_LABELS,
  client_status_label,
  format_role_labels,
} from "@/lib/i18n/labels";
import { ORDER_STATUS_LABELS } from "@/lib/orders/constants";
import { AVAILABILITY_LABELS } from "@/lib/catalog/constants";

describe("health and UI labels E1.14", () => {
  it("health returns database ok without secrets", async () => {
    const response = await health_get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, database: "ok" });
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|SESSION_SECRET|password/i);
  });

  it("role and status labels are Russian and stable", () => {
    expect(ROLE_LABELS.director).toBe("Руководитель");
    expect(ROLE_LABELS.manager).toBe("Менеджер");
    expect(ROLE_LABELS.client).toBe("Клиент");
    expect(format_role_labels(["director", "manager"])).toBe(
      "Руководитель, Менеджер",
    );

    expect(CLIENT_STATUS_LABELS.pending).toBe("На рассмотрении");
    expect(CLIENT_STATUS_LABELS.approved).toBe("Подтверждён");
    expect(CLIENT_STATUS_LABELS.rejected).toBe("Отклонён");
    expect(CLIENT_STATUS_LABELS.blocked).toBe("Заблокирован");
    expect(client_status_label("pending")).toBe("На рассмотрении");

    expect(ORDER_STATUS_LABELS.new).toBe("Новый");
    expect(ORDER_STATUS_LABELS.confirmed).toBe("Подтверждён");
    expect(ORDER_STATUS_LABELS.delivered).toBe("Доставлен");
    expect(ORDER_STATUS_LABELS.cancelled).toBe("Отменён");

    expect(AVAILABILITY_LABELS.in_stock).toBe("В наличии");
    expect(AVAILABILITY_LABELS.on_order).toBe("Под заказ");
    expect(AVAILABILITY_LABELS.out_of_stock).toBe("Временно нет");
  });
});
