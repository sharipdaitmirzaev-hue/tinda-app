import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  get_post_auth_path,
  resolve_client_shop_access,
  resolve_pending_page_access,
  resolve_staff_access,
  type AuthUserPayload,
} from "@/lib/access";
import { prisma } from "@/lib/db";
import { login_user } from "@/lib/services/auth.service";
import { get_registration_status } from "@/lib/services/client-status.service";
import { build_auth_payload } from "@/lib/auth/current-user";
import { hash_password } from "@/lib/auth/password";

function client_payload(
  status: string,
  overrides?: Partial<AuthUserPayload>,
): AuthUserPayload {
  return {
    user: {
      id: "user-1",
      email: "client@example.com",
      full_name: "Клиент",
      roles: ["client"],
    },
    client: {
      id: "client-1",
      status,
      company_name: "ООО Тест",
    },
    employee: null,
    ...overrides,
  };
}

describe("client status access rules", () => {
  it("pending: shop denied, pending allowed, redirect /pending", () => {
    const payload = client_payload("pending");
    expect(get_post_auth_path(payload)).toBe("/pending");
    expect(resolve_pending_page_access(payload)).toEqual({ allow: true });
    expect(resolve_client_shop_access(payload)).toEqual({
      allow: false,
      redirect_to: "/pending",
    });
    expect(resolve_staff_access(payload)).toEqual({
      allow: false,
      redirect_to: "/pending",
    });
  });

  it("rejected: shop denied, pending allowed", () => {
    const payload = client_payload("rejected");
    expect(get_post_auth_path(payload)).toBe("/pending");
    expect(resolve_pending_page_access(payload)).toEqual({ allow: true });
    expect(resolve_client_shop_access(payload)).toEqual({
      allow: false,
      redirect_to: "/pending",
    });
  });

  it("blocked: shop denied, pending allowed, full client shop ban", () => {
    const payload = client_payload("blocked");
    expect(get_post_auth_path(payload)).toBe("/pending");
    expect(resolve_pending_page_access(payload)).toEqual({ allow: true });
    expect(resolve_client_shop_access(payload)).toEqual({
      allow: false,
      redirect_to: "/pending",
    });
    // catalog / cart / orders all use the same shop guard
    for (const path of ["/catalog", "/cart", "/orders"]) {
      expect(resolve_client_shop_access(payload).allow).toBe(false);
      void path;
    }
  });

  it("approved: shop allowed, pending redirects to catalog", () => {
    const payload = client_payload("approved");
    expect(get_post_auth_path(payload)).toBe("/catalog");
    expect(resolve_client_shop_access(payload)).toEqual({ allow: true });
    expect(resolve_pending_page_access(payload)).toEqual({
      allow: false,
      redirect_to: "/catalog",
    });
  });

  it("guest is sent to login for protected areas", () => {
    expect(resolve_client_shop_access(null)).toEqual({
      allow: false,
      redirect_to: "/login",
    });
    expect(resolve_pending_page_access(null)).toEqual({
      allow: false,
      redirect_to: "/login",
    });
    expect(resolve_staff_access(null)).toEqual({
      allow: false,
      redirect_to: "/login",
    });
  });

  it("staff cannot open pending or client shop; can open staff", () => {
    const manager: AuthUserPayload = {
      user: {
        id: "m1",
        email: "manager@example.com",
        full_name: "Менеджер",
        roles: ["manager"],
      },
      client: null,
      employee: { can_view_all_clients: false, can_edit_catalog: false },
    };

    expect(resolve_staff_access(manager)).toEqual({ allow: true });
    expect(resolve_pending_page_access(manager)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(resolve_client_shop_access(manager)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });

    const director: AuthUserPayload = {
      ...manager,
      user: { ...manager.user, id: "d1", roles: ["director"] },
      employee: { can_view_all_clients: true, can_edit_catalog: true },
    };
    expect(resolve_staff_access(director)).toEqual({ allow: true });
    expect(resolve_pending_page_access(director)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
  });

  it("client cannot open staff area", () => {
    const payload = client_payload("approved");
    expect(resolve_staff_access(payload)).toEqual({
      allow: false,
      redirect_to: "/catalog",
    });
  });
});

describe("client status integration", () => {
  const suffix = `st_${Date.now()}`;
  const email = `${suffix}@example.com`;
  const password = "Password1!";
  let user_id: string;
  let client_id: string;
  let city_id: string;

  beforeAll(async () => {
    const city = await prisma.cities.findFirst({ where: { is_active: true } });
    if (!city) {
      throw new Error("No cities. Run npm run db:seed");
    }
    city_id = city.id;

    const role = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password(password);

    const user = await prisma.users.create({
      data: {
        email,
        phone: "+79280009988",
        password_hash,
        full_name: "Status Test",
        user_roles: { create: [{ role_id: role.id }] },
        client: {
          create: {
            company_name: "Status Co",
            inn: `88${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`.slice(
              0,
              10,
            ),
            city_id,
            status: "pending",
            contact_name: "Status Test",
            phone: "+79280009988",
            email,
            address: "Махачкала, тест",
            pdn_accepted_at: new Date(),
          },
        },
      },
      include: { client: true },
    });
    user_id = user.id;
    client_id = user.client!.id;
  });

  afterAll(async () => {
    await prisma.sessions.deleteMany({ where: { user_id } });
    await prisma.clients.deleteMany({ where: { id: client_id } });
    await prisma.user_roles.deleteMany({ where: { user_id } });
    await prisma.users.deleteMany({ where: { id: user_id } });
    await prisma.$disconnect();
  });

  it("registration-status returns pending and support contacts", async () => {
    const payload = await build_auth_payload(user_id);
    expect(payload).toBeTruthy();
    const status = await get_registration_status(payload!);
    expect(status.status).toBe("pending");
    expect(status.company_name).toBe("Status Co");
    expect(status.redirect_to).toBe("/pending");
    expect(status.support_email).toBeTruthy();
  });

  it("allows blocked client to log in and land on pending path", async () => {
    await prisma.clients.update({
      where: { id: client_id },
      data: { status: "blocked" },
    });

    const logged_in = await login_user({ login: email, password });
    expect(logged_in.client?.status).toBe("blocked");
    expect(get_post_auth_path(logged_in)).toBe("/pending");
    expect(resolve_client_shop_access(logged_in).allow).toBe(false);

    await prisma.clients.update({
      where: { id: client_id },
      data: { status: "pending" },
    });
  });

  it("rejected status exposes reason via registration-status", async () => {
    await prisma.clients.update({
      where: { id: client_id },
      data: {
        status: "rejected",
        rejected_reason: "Неполные реквизиты",
      },
    });

    const payload = await build_auth_payload(user_id);
    const status = await get_registration_status(payload!);
    expect(status.status).toBe("rejected");
    expect(status.rejected_reason).toBe("Неполные реквизиты");
    expect(status.redirect_to).toBe("/pending");
  });

  it("approved status redirects to catalog and opens shop", async () => {
    await prisma.clients.update({
      where: { id: client_id },
      data: {
        status: "approved",
        approved_at: new Date(),
        rejected_reason: null,
      },
    });

    const payload = await build_auth_payload(user_id);
    const status = await get_registration_status(payload!);
    expect(status.status).toBe("approved");
    expect(status.redirect_to).toBe("/catalog");
    expect(resolve_client_shop_access(payload!).allow).toBe(true);
    expect(resolve_pending_page_access(payload!)).toEqual({
      allow: false,
      redirect_to: "/catalog",
    });
  });
});
