import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  create_category,
  update_category,
} from "@/lib/services/categories.service";
import {
  create_product,
  list_catalog_products,
  get_catalog_product,
} from "@/lib/services/products.service";
import { list_staff_categories } from "@/lib/services/categories.service";

const suffix = `cat_${Date.now()}`;

describe("catalog E1.5", () => {
  let director_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let manager_with_right: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let manager_without_right: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let approved_client: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let pending_client: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;

  const cleanup_category_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];

  beforeAll(async () => {
    director_payload = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    manager_with_right = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager1@tinda.local" },
        })
      ).id,
    ))!;
    manager_without_right = (await build_auth_payload(
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
    const password_hash = await hash_password("Password1!");

    async function make_client(status: "pending" | "approved", label: string) {
      const inn = `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-10);
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
              contact_name: label,
              phone: `+7928${inn.slice(0, 7)}`,
              email,
              address: "Махачкала",
              pdn_accepted_at: new Date(),
              approved_at: status === "approved" ? new Date() : null,
            },
          },
        },
        include: { client: true },
      });
      cleanup_user_ids.push(user.id);
      cleanup_client_ids.push(user.client!.id);
      return (await build_auth_payload(user.id))!;
    }

    approved_client = await make_client("approved", "ApprovedCat");
    pending_client = await make_client("pending", "PendingCat");
  });

  afterAll(async () => {
    await prisma.products.deleteMany({
      where: { id: { in: cleanup_product_ids } },
    });
    await prisma.categories.deleteMany({
      where: { id: { in: cleanup_category_ids } },
    });
    await prisma.clients.deleteMany({
      where: { id: { in: cleanup_client_ids } },
    });
    await prisma.user_roles.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: cleanup_user_ids } },
    });
    await prisma.$disconnect();
  });

  it("director creates category", async () => {
    const result = await create_category(director_payload, {
      name: `Тест ${suffix}`,
      slug: `test-${suffix}`,
      sort_order: 99,
      is_active: true,
    });
    cleanup_category_ids.push(result.category.id);
    expect(result.category.name).toContain("Тест");
  });

  it("manager with can_edit_catalog creates category", async () => {
    const result = await create_category(manager_with_right, {
      name: `Mgr ${suffix}`,
      slug: `mgr-${suffix}`,
      is_active: true,
    });
    cleanup_category_ids.push(result.category.id);
    expect(result.category.slug).toBe(`mgr-${suffix}`);
  });

  it("manager without can_edit_catalog gets 403", async () => {
    await expect(
      list_staff_categories(manager_without_right),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("client gets 403 for staff categories API logic", async () => {
    await expect(list_staff_categories(approved_client)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("category slug is unique", async () => {
    const first = await create_category(director_payload, {
      name: "Slug A",
      slug: `unique-${suffix}`,
    });
    cleanup_category_ids.push(first.category.id);

    await expect(
      create_category(director_payload, {
        name: "Slug B",
        slug: `unique-${suffix}`,
      }),
    ).rejects.toMatchObject({
      message: "Slug категории уже используется",
    });
  });

  it("cannot create category cycle", async () => {
    const parent = await create_category(director_payload, {
      name: "Parent cycle",
      slug: `parent-cycle-${suffix}`,
    });
    const child = await create_category(director_payload, {
      name: "Child cycle",
      slug: `child-cycle-${suffix}`,
      parent_id: parent.category.id,
    });
    cleanup_category_ids.push(child.category.id, parent.category.id);

    await expect(
      update_category(director_payload, parent.category.id, {
        parent_id: child.category.id,
      }),
    ).rejects.toMatchObject({
      message: "Нельзя создать циклическую вложенность категорий",
    });
  });

  it("product sku is unique and qty rules enforced", async () => {
    const category = await create_category(director_payload, {
      name: "Prod cat",
      slug: `prod-cat-${suffix}`,
    });
    cleanup_category_ids.push(category.category.id);

    const created = await create_product(director_payload, {
      sku: `SKU-${suffix}`,
      name: "Товар тест",
      category_id: category.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "in_stock",
    });
    cleanup_product_ids.push(created.product.id);

    await expect(
      create_product(director_payload, {
        sku: `SKU-${suffix}`,
        name: "Дубль",
        category_id: category.category.id,
        units_per_package: 6,
        sale_unit: "упаковка",
        min_order_qty: 6,
        availability: "in_stock",
      }),
    ).rejects.toMatchObject({ message: "Артикул уже используется" });

    await expect(
      create_product(director_payload, {
        sku: `SKU-BAD-${suffix}`,
        name: "Плохой",
        category_id: category.category.id,
        units_per_package: 0,
        sale_unit: "упаковка",
        min_order_qty: 1,
        availability: "in_stock",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  it("inactive product and inactive category are hidden from client API", async () => {
    const active_category = await create_category(director_payload, {
      name: "Active cat",
      slug: `active-cat-${suffix}`,
      is_active: true,
    });
    const inactive_category = await create_category(director_payload, {
      name: "Inactive cat",
      slug: `inactive-cat-${suffix}`,
      is_active: false,
    });
    cleanup_category_ids.push(
      active_category.category.id,
      inactive_category.category.id,
    );

    const active_product = await create_product(director_payload, {
      sku: `ACT-${suffix}`,
      name: "Активный товар",
      category_id: active_category.category.id,
      units_per_package: 1,
      sale_unit: "шт",
      min_order_qty: 1,
      availability: "in_stock",
      is_active: true,
    });
    const inactive_product = await create_product(director_payload, {
      sku: `INA-${suffix}`,
      name: "Неактивный товар",
      category_id: active_category.category.id,
      units_per_package: 1,
      sale_unit: "шт",
      min_order_qty: 1,
      availability: "in_stock",
      is_active: false,
    });
    const product_in_inactive_category = await create_product(director_payload, {
      sku: `INC-${suffix}`,
      name: "В неактивной категории",
      category_id: inactive_category.category.id,
      units_per_package: 1,
      sale_unit: "шт",
      min_order_qty: 1,
      availability: "in_stock",
      is_active: true,
    });
    cleanup_product_ids.push(
      active_product.product.id,
      inactive_product.product.id,
      product_in_inactive_category.product.id,
    );

    const list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 100,
      sort: "name_asc",
      q: suffix,
    });
    const ids = list.items.map((item) => item.id);
    expect(ids).toContain(active_product.product.id);
    expect(ids).not.toContain(inactive_product.product.id);
    expect(ids).not.toContain(product_in_inactive_category.product.id);

    await expect(
      get_catalog_product(approved_client, inactive_product.product.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("approved client can list products; pending cannot", async () => {
    const list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 20,
      sort: "name_asc",
    });
    expect(list.total).toBeGreaterThan(0);

    await expect(
      list_catalog_products(pending_client, {
        page: 1,
        page_size: 20,
        sort: "name_asc",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "Доступно после подтверждения заявки",
    });
  });
});
