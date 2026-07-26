import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { get_post_auth_path, type AuthUserPayload } from "@/lib/access";
import { register_client, login_user } from "@/lib/services/auth.service";
import { register_schema } from "@/lib/validators/auth";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";

const suffix = Date.now().toString();

describe("auth validators", () => {
  it("rejects registration without personal data consent", () => {
    const result = register_schema.safeParse({
      company_name: "Тест ООО",
      inn: "1234567890",
      city_id: "00000000-0000-4000-8000-000000000001",
      contact_name: "Иван",
      phone: "+79281234567",
      email: "test@example.com",
      address: "Махачкала, ул. Тестовая 1",
      password: "Password1",
      password_confirm: "Password1",
      pdn_accepted: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("pdn_accepted"))).toBe(
        true,
      );
    }
  });

  it("rejects invalid inn", () => {
    const result = register_schema.safeParse({
      company_name: "Тест ООО",
      inn: "123",
      city_id: "00000000-0000-4000-8000-000000000001",
      contact_name: "Иван",
      phone: "+79281234567",
      email: "test@example.com",
      address: "Махачкала, ул. Тестовая 1",
      password: "Password1",
      password_confirm: "Password1",
      pdn_accepted: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("auth access redirects", () => {
  it("sends pending client to /pending", () => {
    const payload: AuthUserPayload = {
      user: {
        id: "1",
        email: "a@b.c",
        full_name: "A",
        roles: ["client"],
      },
      client: { id: "c1", status: "pending", company_name: "Co" },
      employee: null,
    };
    expect(get_post_auth_path(payload)).toBe("/pending");
  });

  it("sends approved client to /catalog", () => {
    const payload: AuthUserPayload = {
      user: {
        id: "1",
        email: "a@b.c",
        full_name: "A",
        roles: ["client"],
      },
      client: { id: "c1", status: "approved", company_name: "Co" },
      employee: null,
    };
    expect(get_post_auth_path(payload)).toBe("/catalog");
  });

  it("sends manager and director to /staff/orders", () => {
    expect(
      get_post_auth_path({
        user: {
          id: "1",
          email: "m@b.c",
          full_name: "M",
          roles: ["manager"],
        },
        client: null,
        employee: { can_view_all_clients: false, can_edit_catalog: false },
      }),
    ).toBe("/staff/orders");

    expect(
      get_post_auth_path({
        user: {
          id: "2",
          email: "d@b.c",
          full_name: "D",
          roles: ["director"],
        },
        client: null,
        employee: { can_view_all_clients: true, can_edit_catalog: true },
      }),
    ).toBe("/staff/orders");
  });
});

describe("auth service integration", () => {
  let city_id: string;
  const email = `client_${suffix}@example.com`;
  const inn = `77${suffix.slice(-8).padStart(8, "0")}`.slice(0, 10);
  const password = "Password1!";

  beforeAll(async () => {
    const city = await prisma.cities.findFirst({ where: { is_active: true } });
    if (!city) {
      throw new Error("No cities in database. Run npm run db:seed");
    }
    city_id = city.id;
  });

  afterAll(async () => {
    const user = await prisma.users.findUnique({ where: { email } });
    if (user) {
      await prisma.sessions.deleteMany({ where: { user_id: user.id } });
      await prisma.clients.deleteMany({ where: { user_id: user.id } });
      await prisma.user_roles.deleteMany({ where: { user_id: user.id } });
      await prisma.users.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  it("registers client with pending status", async () => {
    const payload = await register_client({
      company_name: `Компания ${suffix}`,
      inn,
      kpp: null,
      legal_name: null,
      legal_address: null,
      city_id,
      client_type: "shop",
      contact_name: "Тест Клиент",
      phone: "+79281112233",
      extra_phone: null,
      email,
      address: "Махачкала, ул. Пример 10",
      comment: null,
      password,
      password_confirm: password,
      pdn_accepted: true,
    });

    expect(payload.user.roles).toContain("client");
    expect(payload.client?.status).toBe("pending");
    expect(payload.employee).toBeNull();
  });

  it("rejects duplicate email", async () => {
    await expect(
      register_client({
        company_name: "Другая компания",
        inn: "1234567890",
        kpp: null,
        legal_name: null,
        legal_address: null,
        city_id,
        client_type: null,
        contact_name: "Другой",
        phone: "+79280001122",
        extra_phone: null,
        email,
        address: "Махачкала, ул. Другая 1",
        comment: null,
        password,
        password_confirm: password,
        pdn_accepted: true,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Email уже используется",
    });
  });

  it("rejects duplicate inn", async () => {
    await expect(
      register_client({
        company_name: "Ещё компания",
        inn,
        kpp: null,
        legal_name: null,
        legal_address: null,
        city_id,
        client_type: null,
        contact_name: "Ещё",
        phone: "+79280003344",
        extra_phone: null,
        email: `other_${suffix}@example.com`,
        address: "Махачкала, ул. Ещё 2",
        comment: null,
        password,
        password_confirm: password,
        pdn_accepted: true,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "ИНН уже зарегистрирован",
    });
  });

  it("logs in with email and password", async () => {
    const payload = await login_user({ login: email, password });
    expect(payload.user.email).toBe(email);
    expect(payload.client?.status).toBe("pending");
  });

  it("rejects wrong password", async () => {
    await expect(
      login_user({ login: email, password: "WrongPass1" }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: "Неверный логин или пароль",
    });
  });

  it("blocks blocked client login", async () => {
    const user = await prisma.users.findUniqueOrThrow({ where: { email } });
    await prisma.clients.update({
      where: { user_id: user.id },
      data: { status: "blocked" },
    });

    await expect(
      login_user({ login: email, password }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });

    await prisma.clients.update({
      where: { user_id: user.id },
      data: { status: "pending" },
    });
  });

  it("builds auth payload with roles for seed director", async () => {
    const director = await prisma.users.findUnique({
      where: { email: "director@tinda.local" },
    });
    expect(director).toBeTruthy();
    const payload = await build_auth_payload(director!.id);
    expect(payload?.user.roles).toContain("director");
    expect(payload?.employee?.can_view_all_clients).toBe(true);
  });

  it("hashes passwords (not stored plain)", async () => {
    const hash = await hash_password("Secret123");
    expect(hash).not.toBe("Secret123");
    expect(hash.startsWith("$2")).toBe(true);
  });
});
