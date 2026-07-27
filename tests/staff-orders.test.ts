import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import { add_cart_item } from "@/lib/services/cart.service";
import {
  assign_order_manager,
  cancel_staff_order,
  confirm_staff_order,
  create_order_from_cart,
  deliver_staff_order,
  get_client_order,
  get_staff_order,
  list_staff_orders,
  update_staff_order,
} from "@/lib/services/order.service";
import { create_order_schema } from "@/lib/validators/orders";
import { today_date_key } from "@/lib/dates";

const suffix = `stord_${Date.now()}`;

describe("staff orders E1.11", () => {
  let director: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let manager1: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let manager2: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let manager_all: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_a: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_b: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_orphan: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let client_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;

  let category_id: string;
  let product_id: string;
  let product_b_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];

  beforeAll(async () => {
    director = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    manager1 = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager1@tinda.local" },
        })
      ).id,
    ))!;
    manager2 = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager2@tinda.local" },
        })
      ).id,
    ))!;

    const role_manager = await prisma.roles.findUniqueOrThrow({
      where: { code: "manager" },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });

    const all_user = await prisma.users.create({
      data: {
        email: `mgr_all_${suffix}@tinda.local`,
        phone: "+79280000001",
        password_hash,
        full_name: "Manager All",
        user_roles: { create: [{ role_id: role_manager.id }] },
        employee_profile: {
          create: {
            can_view_all_clients: true,
            can_edit_catalog: false,
          },
        },
      },
    });
    cleanup_user_ids.push(all_user.id);
    manager_all = (await build_auth_payload(all_user.id))!;

    async function make_client(
      label: string,
      manager_id: string | null,
    ) {
      const inn = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
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
              company_name: `${label} Co`,
              inn,
              city_id: city.id,
              status: "approved",
              manager_id,
              contact_name: label,
              phone: `+7928${inn.slice(0, 7)}`,
              email,
              address: "Махачкала",
              pdn_accepted_at: new Date(),
              approved_at: new Date(),
            },
          },
        },
        include: { client: true },
      });
      cleanup_user_ids.push(user.id);
      cleanup_client_ids.push(user.client!.id);
      return (await build_auth_payload(user.id))!;
    }

    approved_a = await make_client("StaffA", manager1.user.id);
    approved_b = await make_client("StaffB", manager2.user.id);
    approved_orphan = await make_client("StaffOrphan", null);
    client_payload = approved_a;

    const category = await prisma.categories.create({
      data: {
        name: `StaffOrd ${suffix}`,
        slug: `staff-ord-${suffix}`,
        is_active: true,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    async function make_product(sku: string) {
      const product = await prisma.products.create({
        data: {
          sku,
          name: `Staff Product ${sku}`,
          brand: "Brand",
          category_id,
          volume_text: "1 л",
          package_type: "блок",
          units_per_package: 12,
          sale_unit: "шт",
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "in_stock",
          sales_status: "orderable",
          is_active: true,
          price_amount: 120,
          price_currency: "RUB",
        },
      });
      cleanup_product_ids.push(product.id);
      return product.id;
    }

    product_id = await make_product(`ST-${suffix}-1`);
    product_b_id = await make_product(`ST-${suffix}-2`);
  });

  beforeEach(async () => {
    await prisma.order_idempotency_keys.deleteMany({
      where: {
        order: { client_id: { in: cleanup_client_ids } },
      },
    });
    await prisma.order_status_history.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.order_items.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.orders.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
  });

  afterAll(async () => {
    await prisma.order_idempotency_keys.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.order_status_history.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.order_items.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.orders.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.products.deleteMany({
      where: { id: { in: cleanup_product_ids } },
    });
    await prisma.categories.deleteMany({
      where: { id: { in: cleanup_category_ids } },
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
    await prisma.users.deleteMany({
      where: { id: { in: cleanup_user_ids } },
    });
    await prisma.$disconnect();
  });

  function valid_create() {
    return create_order_schema.parse({
      address: "Махачкала",
      desired_delivery_date: today_date_key(),
      contact_name: "Контакт",
      contact_phone: "+79281112233",
      payment_method: "bank_transfer",
      is_urgent: false,
      client_comment: null,
    });
  }

  async function place_order(
    client: typeof approved_a,
    urgent = false,
  ) {
    await add_cart_item(client, { product_id, qty: 12 });
    return create_order_from_cart(
      client,
      create_order_schema.parse({
        ...valid_create(),
        is_urgent: urgent,
      }),
      randomUUID(),
    );
  }

  it("director sees all; manager sees scoped; can_view_all sees all", async () => {
    const a = await place_order(approved_a);
    const b = await place_order(approved_b);

    const director_list = await list_staff_orders(director, {
      page: 1,
      page_size: 50,
      sort: "created_at_desc",
    });
    const director_ids = director_list.items.map((item) => item.id);
    expect(director_ids).toContain(a.order.id);
    expect(director_ids).toContain(b.order.id);

    const m1 = await list_staff_orders(manager1, {
      page: 1,
      page_size: 50,
      sort: "created_at_desc",
    });
    expect(m1.items.map((item) => item.id)).toContain(a.order.id);
    expect(m1.items.map((item) => item.id)).not.toContain(b.order.id);

    const all = await list_staff_orders(manager_all, {
      page: 1,
      page_size: 50,
      sort: "created_at_desc",
    });
    expect(all.items.map((item) => item.id)).toContain(a.order.id);
    expect(all.items.map((item) => item.id)).toContain(b.order.id);
  });

  it("manager cannot get foreign order; client forbidden", async () => {
    const created = await place_order(approved_a);
    await expect(get_staff_order(manager2, created.order.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      list_staff_orders(client_payload, {
        page: 1,
        page_size: 20,
        sort: "created_at_desc",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("filters, search and pagination work", async () => {
    const baseline = await list_staff_orders(manager1, {
      page: 1,
      page_size: 1,
      sort: "created_at_desc",
    });

    const first = await place_order(approved_a, true);
    await place_order(approved_a, false);

    const urgent = await list_staff_orders(manager1, {
      is_urgent: true,
      page: 1,
      page_size: 20,
      sort: "created_at_desc",
    });
    expect(urgent.total).toBeGreaterThanOrEqual(1);
    expect(urgent.items.some((item) => item.id === first.order.id)).toBe(true);

    const by_q = await list_staff_orders(manager1, {
      q: "StaffA",
      page: 1,
      page_size: 20,
      sort: "created_at_desc",
    });
    expect(by_q.total).toBeGreaterThanOrEqual(1);

    const page1 = await list_staff_orders(manager1, {
      page: 1,
      page_size: 1,
      sort: "created_at_desc",
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(baseline.total + 2);
  });

  it("confirm / cancel / deliver transitions and history", async () => {
    const created = await place_order(approved_a);
    const confirmed = await confirm_staff_order(manager1, created.order.id, {
      manager_comment: "Ок",
    });
    expect(confirmed.message).toBe("Заказ подтверждён");
    expect(confirmed.order.status).toBe("confirmed");
    expect(confirmed.order.manager_comment).toBe("Ок");
    expect(
      confirmed.order.status_history.some((row) => row.to_status === "confirmed"),
    ).toBe(true);

    await expect(
      confirm_staff_order(manager1, created.order.id, {
        manager_comment: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CONFLICT" });

    const delivered = await deliver_staff_order(manager1, created.order.id, {
      manager_comment: null,
    });
    expect(delivered.message).toBe("Заказ отмечен как доставленный");
    expect(delivered.order.status).toBe("delivered");

    await expect(
      deliver_staff_order(manager1, created.order.id, {
        manager_comment: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CONFLICT" });

    const another = await place_order(approved_a);
    await expect(
      deliver_staff_order(manager1, another.order.id, {
        manager_comment: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CONFLICT" });

    const cancelled = await cancel_staff_order(manager1, another.order.id, {
      reason: "Нет товара",
      manager_comment: "внутр",
    });
    expect(cancelled.message).toBe("Заказ отменён");
    expect(cancelled.order.status).toBe("cancelled");
    expect(cancelled.order.cancel_reason).toBe("Нет товара");

    await expect(
      cancel_staff_order(manager1, another.order.id, {
        reason: "ещё раз",
        manager_comment: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CONFLICT" });

    await expect(
      update_staff_order(manager1, another.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        manager_comment: null,
        items: [{ product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CONFLICT" });
  });

  it("confirmed can be cancelled; manager_comment hidden from client API", async () => {
    const created = await place_order(approved_a);
    await confirm_staff_order(manager1, created.order.id, {
      manager_comment: "Секрет",
    });
    const client_view = await get_client_order(approved_a, created.order.id);
    expect(JSON.stringify(client_view)).not.toContain("manager_comment");
    expect(client_view.order).not.toHaveProperty("manager_comment");
    expect(
      client_view.order.status_history.every((row) => row.comment === null),
    ).toBe(true);

    const cancelled = await cancel_staff_order(director, created.order.id, {
      reason: "Клиент отказался",
      manager_comment: null,
    });
    expect(cancelled.order.status).toBe("cancelled");
  });

  it("manager edits accessible new/confirmed; foreign edit forbidden", async () => {
    const created = await place_order(approved_a);
    const updated = await update_staff_order(manager1, created.order.id, {
      address: "Новый адрес staff",
      desired_delivery_date: today_date_key(),
      contact_name: "Staff Contact",
      contact_phone: "+79285556677",
      payment_method: "cash_on_delivery",
      is_urgent: true,
      client_comment: null,
      manager_comment: "внутр правка",
      items: [
        { product_id, qty: 24 },
        { product_id: product_b_id, qty: 12 },
      ],
    });
    expect(updated.order.address).toBe("Новый адрес staff");
    expect(updated.order.items_count).toBe(2);
    expect(updated.order.manager_comment).toBe("внутр правка");
    expect(updated.order.items[0]?.unit_price).toEqual(expect.any(Number));
    expect(updated.order.subtotal).toEqual(expect.any(Number));
    expect(updated.order.delivery_total).toBe(0);

    const foreign = await place_order(approved_b);
    await expect(
      update_staff_order(manager1, foreign.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        manager_comment: null,
        items: [{ product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      update_staff_order(manager1, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        manager_comment: null,
        items: [],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      update_staff_order(manager1, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя Достаточно",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        manager_comment: null,
        items: [{ product_id, qty: 18 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("manager can claim orphan order; cannot assign another manager", async () => {
    const created = await place_order(approved_orphan);
    // orphan client has no manager — manager1 has no access initially
    await expect(get_staff_order(manager1, created.order.id)).rejects.toMatchObject({
      status: 404,
    });

    // director assigns null stays; manager_all can see and claim isn't needed
    const claimed = await assign_order_manager(director, created.order.id, {
      manager_id: manager1.user.id,
    });
    expect(claimed.order.manager?.id).toBe(manager1.user.id);

    await expect(
      assign_order_manager(manager1, created.order.id, {
        manager_id: manager2.user.id,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // create another orphan for self-claim via confirm
    const orphan2 = await place_order(approved_orphan);
    await prisma.orders.update({
      where: { id: orphan2.order.id },
      data: { manager_id: null },
    });
    // give manager1 access by temporarily setting client manager? Spec: confirm can claim if client without manager.
    // But manager1 still can't access order without client.manager_id or order.manager_id.
    // So claim via director first to null and assign access... Actually for orphan client, only director/can_view_all can access.
    const by_all = await get_staff_order(manager_all, orphan2.order.id);
    expect(by_all.order.manager).toBeNull();

    const confirmed = await confirm_staff_order(manager_all, orphan2.order.id, {
      manager_comment: null,
    });
    // manager_all has can_view_all; auto-claim only for non-director managers when client has no manager
    expect(confirmed.order.manager?.id).toBe(manager_all.user.id);
  });

  it("director can assign any manager or null", async () => {
    const created = await place_order(approved_a);
    const assigned = await assign_order_manager(director, created.order.id, {
      manager_id: manager2.user.id,
    });
    expect(assigned.order.manager?.id).toBe(manager2.user.id);

    const cleared = await assign_order_manager(director, created.order.id, {
      manager_id: null,
    });
    expect(cleared.order.manager).toBeNull();
  });
});
