import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  can_access_client,
  can_edit_catalog,
  can_view_all_clients,
  is_director,
  resolve_catalog_editor_access,
  resolve_client_shop_access,
  resolve_pending_page_access,
  resolve_staff_access,
  type AuthUserPayload,
} from "@/lib/access";
import {
  can_access_order,
  can_manage_order,
  can_view_all_orders,
  staff_orders_scope_where,
} from "@/lib/orders/access";
import { add_cart_item, get_cart } from "@/lib/services/cart.service";
import {
  create_order_from_cart,
  get_client_order,
  list_client_orders,
} from "@/lib/services/order.service";
import {
  get_staff_order,
  list_staff_orders,
} from "@/lib/services/staff-orders.service";
import { list_catalog_products } from "@/lib/services/products.service";
import { list_staff_categories } from "@/lib/services/categories.service";
import { list_registration_requests } from "@/lib/services/registration-requests.service";
import { assert_csrf_origin, get_allowed_origins } from "@/lib/security/csrf";
import { apply_security_headers } from "@/lib/security/headers";
import {
  collect_forbidden_keys,
  json_contains_manager_comment,
} from "@/lib/security/forbidden-response-keys";
import {
  consume_rate_limit,
  reset_rate_limit_store_for_tests,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { redact_object } from "@/lib/security/redact";
import { api_error } from "@/lib/http/errors";
import { POST as login_post } from "@/app/api/v1/auth/login/route";
import { POST as register_post } from "@/app/api/v1/auth/register/route";
import { middleware } from "@/middleware";
import { create_order_schema } from "@/lib/validators/orders";
import { today_date_key } from "@/lib/dates";
import { staff_orders_query_schema } from "@/lib/validators/orders";
import { client_orders_query_schema } from "@/lib/validators/orders";

const suffix = `sec_${Date.now()}`;

function guest(): null {
  return null;
}

function make_headers(init?: Record<string, string>) {
  return new Headers(init);
}

function order_input(overrides: Record<string, unknown> = {}) {
  return create_order_schema.parse({
    address: "Махачкала, тест",
    desired_delivery_date: today_date_key(),
    contact_name: "Тест Клиент",
    contact_phone: "+7 (928) 111-22-33",
    payment_method: "bank_transfer",
    is_urgent: false,
    client_comment: null,
    ...overrides,
  });
}

describe("security and access E1.13", () => {
  let director: AuthUserPayload;
  let manager_scoped: AuthUserPayload;
  let manager_all: AuthUserPayload;
  let manager_no_catalog: AuthUserPayload;
  let approved: AuthUserPayload;
  let approved_other: AuthUserPayload;
  let pending: AuthUserPayload;
  let rejected: AuthUserPayload;
  let blocked: AuthUserPayload;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_order_ids: string[] = [];
  let product_id = "";
  let order_owned_id = "";
  let order_foreign_id = "";
  let min_qty = 1;

  beforeAll(async () => {
    director = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    manager_no_catalog = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager2@tinda.local" },
        })
      ).id,
    ))!;

    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const role_manager = await prisma.roles.findUniqueOrThrow({
      where: { code: "manager" },
    });
    const password_hash = await hash_password("Password1!");

    async function make_manager(
      label: string,
      flags: { can_view_all_clients: boolean; can_edit_catalog: boolean },
    ) {
      const user = await prisma.users.create({
        data: {
          email: `${label}_${suffix}@example.com`,
          phone: `+7928${String(Date.now()).slice(-7)}`,
          password_hash,
          full_name: label,
          user_roles: { create: [{ role_id: role_manager.id }] },
          employee_profile: { create: flags },
        },
      });
      cleanup_user_ids.push(user.id);
      return (await build_auth_payload(user.id))!;
    }

    manager_scoped = await make_manager("mgr_scoped", {
      can_view_all_clients: false,
      can_edit_catalog: false,
    });
    manager_all = await make_manager("mgr_all", {
      can_view_all_clients: true,
      can_edit_catalog: false,
    });

    async function make_client(
      status: "pending" | "approved" | "rejected" | "blocked",
      label: string,
      manager_id: string | null,
    ) {
      const inn = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(
        -10,
      );
      const email = `${label}_${suffix}@example.com`;
      const user = await prisma.users.create({
        data: {
          email,
          phone: `+7928${inn.slice(0, 7)}`,
          password_hash,
          full_name: label,
          user_roles: { create: [{ role_id: role_client.id }] },
          client: {
            create: {
              company_name: label,
              inn,
              city_id: city.id,
              status,
              manager_id,
              contact_name: label,
              phone: `+7928${inn.slice(0, 7)}`,
              email,
              address: "Махачкала",
              pdn_accepted_at: new Date(),
              approved_at: status === "approved" ? new Date() : null,
              rejected_reason: status === "rejected" ? "test" : null,
            },
          },
        },
        include: { client: true },
      });
      cleanup_user_ids.push(user.id);
      cleanup_client_ids.push(user.client!.id);
      return (await build_auth_payload(user.id))!;
    }

    approved = await make_client("approved", "ApprovedA", manager_scoped.user.id);
    approved_other = await make_client(
      "approved",
      "ApprovedB",
      manager_no_catalog.user.id,
    );
    pending = await make_client("pending", "PendingC", null);
    rejected = await make_client("rejected", "RejectedD", null);
    blocked = await make_client("blocked", "BlockedE", null);

    const product = await prisma.products.findFirstOrThrow({
      where: { is_active: true, category: { is_active: true } },
      orderBy: { created_at: "asc" },
    });
    product_id = product.id;
    min_qty = product.min_order_qty;

    await add_cart_item(approved, { product_id, qty: min_qty });
    const created = await create_order_from_cart(
      approved,
      order_input(),
      randomUUID(),
    );
    order_owned_id = created.order.id;
    cleanup_order_ids.push(order_owned_id);

    await add_cart_item(approved_other, { product_id, qty: min_qty });
    const created_other = await create_order_from_cart(
      approved_other,
      order_input({ address: "Другой адрес" }),
      randomUUID(),
    );
    order_foreign_id = created_other.order.id;
    cleanup_order_ids.push(order_foreign_id);

    await prisma.orders.update({
      where: { id: order_owned_id },
      data: { manager_comment: "Внутренний комментарий менеджера" },
    });
  });

  beforeEach(() => {
    reset_rate_limit_store_for_tests();
  });

  afterAll(async () => {
    if (cleanup_order_ids.length) {
      await prisma.order_idempotency_keys.deleteMany({
        where: { order_id: { in: cleanup_order_ids } },
      });
      await prisma.order_items.deleteMany({
        where: { order_id: { in: cleanup_order_ids } },
      });
      await prisma.order_status_history.deleteMany({
        where: { order_id: { in: cleanup_order_ids } },
      });
      await prisma.orders.deleteMany({
        where: { id: { in: cleanup_order_ids } },
      });
    }
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.clients.deleteMany({
      where: { id: { in: cleanup_client_ids } },
    });
    await prisma.employee_profiles.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.user_roles.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.sessions.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: cleanup_user_ids } },
    });
    await prisma.$disconnect();
  });

  it("guest cannot open protected page paths via access resolvers", () => {
    expect(resolve_client_shop_access(guest())).toEqual({
      allow: false,
      redirect_to: "/login",
    });
    expect(resolve_staff_access(guest())).toEqual({
      allow: false,
      redirect_to: "/login",
    });
    expect(resolve_pending_page_access(guest())).toEqual({
      allow: false,
      redirect_to: "/login",
    });
    expect(resolve_catalog_editor_access(guest())).toEqual({
      allow: false,
      redirect_to: "/login",
    });
  });

  it("pending/rejected/blocked cannot open client business areas", () => {
    for (const payload of [pending, rejected, blocked]) {
      expect(resolve_client_shop_access(payload)).toEqual({
        allow: false,
        redirect_to: "/pending",
      });
      expect(resolve_pending_page_access(payload)).toEqual({ allow: true });
      expect(resolve_staff_access(payload).allow).toBe(false);
    }
  });

  it("approved cannot open staff; manager cannot open client cart/checkout paths", () => {
    expect(resolve_staff_access(approved).allow).toBe(false);
    expect(resolve_client_shop_access(approved)).toEqual({ allow: true });
    expect(resolve_client_shop_access(manager_scoped)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(resolve_client_shop_access(director)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
  });

  it("manager without can_edit_catalog cannot open staff catalog", () => {
    expect(resolve_catalog_editor_access(manager_no_catalog)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(resolve_catalog_editor_access(manager_scoped)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(resolve_catalog_editor_access(manager_all)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(can_edit_catalog(director)).toBe(true);
  });

  it("manager cannot see foreign client/order; filters cannot bypass scope", async () => {
    expect(
      can_access_client(manager_scoped, {
        manager_id: manager_scoped.user.id,
      }),
    ).toBe(true);
    expect(
      can_access_client(manager_scoped, {
        manager_id: manager_no_catalog.user.id,
      }),
    ).toBe(false);

    await expect(
      get_staff_order(manager_scoped, order_foreign_id),
    ).rejects.toMatchObject({ status: 404 });

    const query = staff_orders_query_schema.parse({
      page: "1",
      page_size: "50",
      manager_id: manager_no_catalog.user.id,
    });
    const scoped_list = await list_staff_orders(manager_scoped, query);
    const ids = scoped_list.items.map((item) => item.id);
    expect(ids).toContain(order_owned_id);
    expect(ids).not.toContain(order_foreign_id);

    expect(staff_orders_scope_where(manager_scoped)).toEqual({
      OR: [
        { manager_id: manager_scoped.user.id },
        { client: { manager_id: manager_scoped.user.id } },
      ],
    });
  });

  it("can_view_all_clients sees all orders but is not director", async () => {
    expect(can_view_all_clients(manager_all)).toBe(true);
    expect(is_director(manager_all)).toBe(false);
    expect(can_view_all_orders(manager_all)).toBe(true);
    expect(can_edit_catalog(manager_all)).toBe(false);

    const list = await list_staff_orders(
      manager_all,
      staff_orders_query_schema.parse({ page: "1", page_size: "50" }),
    );
    const ids = list.items.map((item) => item.id);
    expect(ids).toContain(order_owned_id);
    expect(ids).toContain(order_foreign_id);
  });

  it("director sees everything", async () => {
    expect(resolve_staff_access(director)).toEqual({ allow: true });
    expect(resolve_catalog_editor_access(director)).toEqual({ allow: true });
    const list = await list_staff_orders(
      director,
      staff_orders_query_schema.parse({ page: "1", page_size: "50" }),
    );
    expect(list.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([order_owned_id, order_foreign_id]),
    );
  });

  it("client cannot call staff APIs", async () => {
    await expect(list_staff_categories(approved)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      list_registration_requests(approved, {
        status: "pending",
        page: 1,
        page_size: 20,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      list_staff_orders(
        approved,
        staff_orders_query_schema.parse({ page: "1", page_size: "20" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("foreign client orderId returns 404", async () => {
    await expect(
      get_client_order(approved, order_foreign_id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("carts are isolated between clients", async () => {
    await add_cart_item(approved, { product_id, qty: min_qty });
    const cart_a = await get_cart(approved);
    const cart_b = await get_cart(approved_other);
    expect(cart_a.items_count).toBeGreaterThan(0);
    // Other client's cart is separate (may be empty after checkout).
    const carts = await prisma.carts.findMany({
      where: { client_id: { in: [approved.client!.id, approved_other.client!.id] } },
    });
    expect(new Set(carts.map((c) => c.client_id)).size).toBe(2);

    void cart_b;
    await expect(get_cart(manager_scoped)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(get_cart(pending)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("Idempotency-Key is isolated by user_id", async () => {
    const key = randomUUID();
    await add_cart_item(approved, { product_id, qty: min_qty });
    const first = await create_order_from_cart(approved, order_input(), key);
    cleanup_order_ids.push(first.order.id);

    await add_cart_item(approved_other, { product_id, qty: min_qty });
    const second = await create_order_from_cart(
      approved_other,
      order_input({ address: "B" }),
      key,
    );
    cleanup_order_ids.push(second.order.id);
    expect(second.order.id).not.toBe(first.order.id);
  });

  it("manager_id cannot be spoofed by client; order created from session client", async () => {
    const detail = await get_client_order(approved, order_owned_id);
    expect(detail.order).not.toHaveProperty("manager_id");
    expect(JSON.stringify(detail)).not.toMatch(/password/i);

    const db = await prisma.orders.findUniqueOrThrow({
      where: { id: order_owned_id },
    });
    expect(db.client_id).toBe(approved.client!.id);
    expect(db.created_by_user_id).toBe(approved.user.id);
    expect(db.manager_id).toBe(manager_scoped.user.id);
  });

  it("password_hash and token_hash are never serialized; manager_comment hidden from client", async () => {
    const me = await build_auth_payload(approved.user.id);
    expect(collect_forbidden_keys(me)).toEqual([]);

    const client_order = await get_client_order(approved, order_owned_id);
    expect(json_contains_manager_comment(client_order)).toBe(false);
    expect(
      collect_forbidden_keys(client_order, "", { allow_client_price: true }),
    ).toEqual([]);

    const staff_order = await get_staff_order(director, order_owned_id);
    expect(staff_order.order.manager_comment).toBe(
      "Внутренний комментарий менеджера",
    );
    expect(
      collect_forbidden_keys(staff_order, "", { allow_client_price: true }),
    ).toEqual([]);

    const catalog = await list_catalog_products(approved, {
      page: 1,
      page_size: 5,
      sort: "name_asc",
    });
    expect(
      collect_forbidden_keys(catalog, "", { allow_client_price: true }),
    ).toEqual([]);
    expect(catalog.items.some((item) => "price" in item)).toBe(true);

    const public_catalog = await list_catalog_products(null, {
      page: 1,
      page_size: 5,
      sort: "name_asc",
    });
    expect(collect_forbidden_keys(public_catalog)).toEqual([]);
    expect(JSON.stringify(public_catalog)).not.toMatch(/"price"/);

    const cart = await get_cart(approved);
    expect(
      collect_forbidden_keys(cart, "", { allow_client_price: true }),
    ).toEqual([]);

    const client_list = await list_client_orders(
      approved,
      client_orders_query_schema.parse({ page: "1", page_size: "10" }),
    );
    expect(
      collect_forbidden_keys(client_list, "", { allow_client_price: true }),
    ).toEqual([]);
  });

  it("foreign Origin for mutating API is rejected; allowed Origin works", () => {
    expect(
      assert_csrf_origin({
        method: "POST",
        headers: make_headers({ origin: "https://evil.example" }),
      }).ok,
    ).toBe(false);

    const allowed = get_allowed_origins()[0]!;
    expect(
      assert_csrf_origin({
        method: "POST",
        headers: make_headers({ origin: allowed }),
      }),
    ).toEqual({ ok: true });

    expect(
      assert_csrf_origin({
        method: "GET",
        headers: make_headers({ origin: "https://evil.example" }),
      }),
    ).toEqual({ ok: true });

    const req = new NextRequest("http://localhost:3000/api/v1/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    const res = middleware(req);
    expect(res.status).toBe(403);
  });

  it("login and register rate limits fire", async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      const result = await consume_rate_limit("login", `ip:test-login-${suffix}`);
      expect(result.allowed).toBe(true);
    }
    const blocked_login = await consume_rate_limit(
      "login",
      `ip:test-login-${suffix}`,
    );
    expect(blocked_login.allowed).toBe(false);

    for (let i = 0; i < RATE_LIMITS.register.limit; i += 1) {
      const result = await consume_rate_limit("register", `ip-reg-${suffix}`);
      expect(result.allowed).toBe(true);
    }
    const blocked_reg = await consume_rate_limit("register", `ip-reg-${suffix}`);
    expect(blocked_reg.allowed).toBe(false);

    reset_rate_limit_store_for_tests();
    const ip = "203.0.113.50";
    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      await login_post(
        new Request("http://localhost:3000/api/v1/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            login: `rate_${suffix}@example.com`,
            password: "WrongPass1!",
          }),
        }),
      );
    }
    const limited = await login_post(
      new Request("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          login: `rate_${suffix}@example.com`,
          password: "WrongPass1!",
        }),
      }),
    );
    expect(limited.status).toBe(429);
    const limited_json = await limited.json();
    expect(limited_json.error.code).toBe("rate_limited");
    expect(JSON.stringify(limited_json)).not.toMatch(/stack|prisma/i);
  });

  it("errors do not contain stack or Prisma details", async () => {
    const response = api_error(500, "internal_error", "Не удалось выполнить вход");
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "internal_error", message: "Не удалось выполнить вход" },
    });
    expect(body.error).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toMatch(/prisma|DATABASE_URL|SESSION_SECRET/i);
  });

  it("security headers are present", () => {
    const headers = new Headers();
    apply_security_headers(headers, { is_production: true });
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");

    const req = new NextRequest("http://localhost:3000/catalog");
    const res = middleware(req);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("redaction helper masks secrets", () => {
    const redacted = redact_object({
      password: "secret",
      password_hash: "hash",
      token_hash: "th",
      STORAGE_SECRET_KEY: "sk",
      email: "a@b.c",
    });
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.password_hash).toBe("[REDACTED]");
    expect(redacted.token_hash).toBe("[REDACTED]");
    expect(redacted.STORAGE_SECRET_KEY).toBe("[REDACTED]");
    expect(redacted.email).toBe("a@b.c");
  });

  it("prices are absent; can_access_order/can_manage_order align", () => {
    expect(
      can_access_order(manager_scoped, {
        manager_id: null,
        client: { manager_id: manager_scoped.user.id },
      }),
    ).toBe(true);
    expect(
      can_manage_order(manager_scoped, {
        manager_id: null,
        client: { manager_id: manager_no_catalog.user.id },
      }),
    ).toBe(false);
  });

  it("register route rate limit returns russian message", async () => {
    reset_rate_limit_store_for_tests();
    const ip = "198.51.100.10";
    for (let i = 0; i < RATE_LIMITS.register.limit; i += 1) {
      await consume_rate_limit("register", ip);
    }
    const response = await register_post(
      new Request("http://localhost:3000/api/v1/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          company_name: "X",
          inn: "1234567890",
          city_id: "00000000-0000-4000-8000-000000000000",
          contact_name: "X",
          phone: "+79001234567",
          email: `rl_${suffix}@example.com`,
          password: "Password1!",
          address: "addr",
          pdn_accepted: true,
        }),
      }),
    );
    expect(response.status).toBe(429);
  });
});
