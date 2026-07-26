import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  approve_registration_request,
  list_registration_requests,
  reject_registration_request,
} from "@/lib/services/registration-requests.service";
import { AppError } from "@/lib/http/errors";

const suffix = `rr_${Date.now()}`;

async function create_pending_client(label: string) {
  const city = await prisma.cities.findFirstOrThrow({
    where: { is_active: true },
  });
  const role = await prisma.roles.findUniqueOrThrow({
    where: { code: "client" },
  });
  const password_hash = await hash_password("Password1!");
  const digits = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const email = `${label}_${suffix}@example.com`;

  const user = await prisma.users.create({
    data: {
      email,
      phone: `+7928${digits.slice(0, 7)}`,
      password_hash,
      full_name: label,
      user_roles: { create: [{ role_id: role.id }] },
      client: {
        create: {
          company_name: `Компания ${label}`,
          inn: digits,
          city_id: city.id,
          client_type: "shop",
          status: "pending",
          contact_name: label,
          phone: `+7928${digits.slice(0, 7)}`,
          email,
          address: "Махачкала, тест",
          comment: "Комментарий",
          pdn_accepted_at: new Date(),
        },
      },
    },
    include: { client: true },
  });

  return { user, client: user.client! };
}

describe("registration requests E1.4", () => {
  const created_user_ids: string[] = [];
  const created_client_ids: string[] = [];
  let manager_payload: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let manager_two_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let director_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let client_payload: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;

  beforeAll(async () => {
    const manager = await prisma.users.findUniqueOrThrow({
      where: { email: "manager1@tinda.local" },
    });
    const manager_two = await prisma.users.findUniqueOrThrow({
      where: { email: "manager2@tinda.local" },
    });
    const director = await prisma.users.findUniqueOrThrow({
      where: { email: "director@tinda.local" },
    });

    const pending_a = await create_pending_client("A");
    const pending_b = await create_pending_client("B");
    created_user_ids.push(pending_a.user.id, pending_b.user.id);
    created_client_ids.push(pending_a.client.id, pending_b.client.id);

    manager_payload = (await build_auth_payload(manager.id))!;
    manager_two_payload = (await build_auth_payload(manager_two.id))!;
    director_payload = (await build_auth_payload(director.id))!;
    client_payload = (await build_auth_payload(pending_a.user.id))!;
  });

  afterAll(async () => {
    await prisma.clients.deleteMany({
      where: { id: { in: created_client_ids } },
    });
    await prisma.user_roles.deleteMany({
      where: { user_id: { in: created_user_ids } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: created_user_ids } },
    });
    await prisma.$disconnect();
  });

  it("manager sees pending requests list", async () => {
    const result = await list_registration_requests(manager_payload, {
      status: "pending",
      page: 1,
      page_size: 50,
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.status === "pending")).toBe(true);
  });

  it("director sees all pending requests", async () => {
    const result = await list_registration_requests(director_payload, {
      status: "pending",
      page: 1,
      page_size: 50,
    });
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it("client has no access to staff registration requests", async () => {
    await expect(
      list_registration_requests(client_payload, {
        status: "pending",
        page: 1,
        page_size: 20,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "Недостаточно прав для этого действия",
    });
  });

  it("manager approves client and becomes manager_id", async () => {
    const pending = await create_pending_client("MgrApprove");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    const result = await approve_registration_request(
      manager_payload,
      pending.client.id,
      { manager_id: manager_two_payload.user.id },
    );

    expect(result.message).toBe("Клиент подтверждён");
    expect(result.request.status).toBe("approved");
    expect(result.request.manager?.id).toBe(manager_payload.user.id);
    expect(result.request.rejected_reason).toBeNull();
    expect(result.request.approved_at).toBeTruthy();
  });

  it("manager cannot assign another manager", async () => {
    const pending = await create_pending_client("MgrIgnoreOther");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    const result = await approve_registration_request(
      manager_payload,
      pending.client.id,
      { manager_id: manager_two_payload.user.id },
    );

    expect(result.request.manager?.id).toBe(manager_payload.user.id);
    expect(result.request.manager?.id).not.toBe(manager_two_payload.user.id);
  });

  it("director can assign selected manager", async () => {
    const pending = await create_pending_client("DirAssign");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    const result = await approve_registration_request(
      director_payload,
      pending.client.id,
      { manager_id: manager_two_payload.user.id },
    );

    expect(result.request.status).toBe("approved");
    expect(result.request.manager?.id).toBe(manager_two_payload.user.id);
  });

  it("director can leave manager_id null", async () => {
    const pending = await create_pending_client("DirNull");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    const result = await approve_registration_request(
      director_payload,
      pending.client.id,
      { manager_id: null },
    );

    expect(result.request.status).toBe("approved");
    expect(result.request.manager).toBeNull();

    const row = await prisma.clients.findUniqueOrThrow({
      where: { id: pending.client.id },
    });
    expect(row.manager_id).toBeNull();
  });

  it("reject without reason is forbidden", async () => {
    const pending = await create_pending_client("RejectEmpty");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    await expect(
      reject_registration_request(manager_payload, pending.client.id, "   "),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      reject_registration_request(manager_payload, pending.client.id, "   "),
    ).rejects.toMatchObject({
      message: "Укажите причину отклонения",
    });
  });

  it("reject stores rejected_reason", async () => {
    const pending = await create_pending_client("RejectOk");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    const result = await reject_registration_request(
      manager_payload,
      pending.client.id,
      "Неполные реквизиты",
    );

    expect(result.message).toBe("Заявка отклонена");
    expect(result.request.status).toBe("rejected");
    expect(result.request.rejected_reason).toBe("Неполные реквизиты");
  });

  it("processed request cannot be approved or rejected again", async () => {
    const pending = await create_pending_client("OnceOnly");
    created_user_ids.push(pending.user.id);
    created_client_ids.push(pending.client.id);

    await approve_registration_request(manager_payload, pending.client.id, {});

    await expect(
      approve_registration_request(manager_payload, pending.client.id, {}),
    ).rejects.toMatchObject({
      message: "Заявка уже обработана",
    });

    await expect(
      reject_registration_request(
        manager_payload,
        pending.client.id,
        "Повтор",
      ),
    ).rejects.toMatchObject({
      message: "Заявка уже обработана",
    });
  });
});
