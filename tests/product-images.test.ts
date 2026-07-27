import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import { resolve_catalog_editor_access } from "@/lib/access";
import {
  create_category,
  update_category,
} from "@/lib/services/categories.service";
import {
  activate_product,
  create_product,
  deactivate_product,
  list_catalog_products,
  remove_product_image,
  update_product,
  upload_product_image,
} from "@/lib/services/products.service";
import {
  clear_memory_product_image_store,
  get_memory_product_image_store,
  set_product_image_storage_for_tests,
  validate_product_image,
  type ProductImageStorageDriver,
} from "@/lib/storage/product-images";

const suffix = `img_${Date.now()}`;

async function make_image(
  format: "jpeg" | "png" | "webp",
  size = 64,
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 20, g: 120, b: 180 },
    },
  });
  if (format === "jpeg") return pipeline.jpeg().toBuffer();
  if (format === "png") return pipeline.png().toBuffer();
  return pipeline.webp().toBuffer();
}

function memory_driver(): ProductImageStorageDriver {
  const store = get_memory_product_image_store();
  return {
    async put(storage_key, body) {
      store.set(storage_key, body);
    },
    async delete(storage_key) {
      store.delete(storage_key);
    },
    build_public_url(storage_key) {
      return `/uploads/${storage_key}`;
    },
  };
}

describe("product images and catalog soft-delete E1.12", () => {
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
  let category_id: string;
  let product_id: string;

  const cleanup_category_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_order_ids: string[] = [];

  beforeAll(async () => {
    set_product_image_storage_for_tests(memory_driver());
    clear_memory_product_image_store();

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
    const inn = `${Date.now()}`.slice(-10);
    const email = `img_client_${suffix}@example.com`;
    const user = await prisma.users.create({
      data: {
        email,
        phone: `+7928${inn.slice(0, 7)}`,
        password_hash,
        full_name: "Img Client",
        user_roles: { create: [{ role_id: role_client.id }] },
        client: {
          create: {
            company_name: "Img Co",
            inn,
            city_id: city.id,
            status: "approved",
            contact_name: "Img",
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
    approved_client = (await build_auth_payload(user.id))!;

    const category = await create_category(director_payload, {
      name: `Img Cat ${suffix}`,
      slug: `img-cat-${suffix}`,
      is_active: true,
    });
    cleanup_category_ids.push(category.category.id);
    category_id = category.category.id;

    const product = await create_product(director_payload, {
      sku: `IMG-${suffix}`,
      name: `Фото товар ${suffix}`,
      category_id,
      units_per_package: 1,
      sale_unit: "шт",
      min_order_qty: 1,
      availability: "in_stock",
      sales_status: "orderable",
      is_active: true,
      price_amount: 200,
    });
    cleanup_product_ids.push(product.product.id);
    product_id = product.product.id;
  });

  beforeEach(() => {
    set_product_image_storage_for_tests(memory_driver());
  });

  afterAll(async () => {
    set_product_image_storage_for_tests(null);
    clear_memory_product_image_store();

    if (cleanup_order_ids.length) {
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

  it("director uploads JPG", async () => {
    const jpeg = await make_image("jpeg");
    const result = await upload_product_image(director_payload, product_id, {
      buffer: jpeg,
      mime_type: "image/jpeg",
      filename: "photo.jpg",
    });
    expect(result.product_id).toBe(product_id);
    expect(result.image_url).toMatch(
      new RegExp(`^/uploads/products/${product_id}/[0-9a-f-]+\\.webp$`, "i"),
    );
    const stored = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
    });
    expect(stored.image_url).toBe(result.image_url);
    expect(get_memory_product_image_store().size).toBeGreaterThan(0);
  });

  it("manager with can_edit_catalog uploads image", async () => {
    const png = await make_image("png");
    const result = await upload_product_image(manager_with_right, product_id, {
      buffer: png,
      mime_type: "image/png",
      filename: "ok.png",
    });
    expect(result.image_url).toContain(`/uploads/products/${product_id}/`);
  });

  it("manager without can_edit_catalog gets 403 on upload", async () => {
    const jpeg = await make_image("jpeg");
    await expect(
      upload_product_image(manager_without_right, product_id, {
        buffer: jpeg,
        mime_type: "image/jpeg",
        filename: "no.jpg",
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("client gets 403 on upload", async () => {
    const jpeg = await make_image("jpeg");
    await expect(
      upload_product_image(approved_client, product_id, {
        buffer: jpeg,
        mime_type: "image/jpeg",
        filename: "client.jpg",
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("PNG and WebP are allowed", async () => {
    const png = await make_image("png");
    const webp = await make_image("webp");
    expect(
      validate_product_image({
        buffer: png,
        mime_type: "image/png",
        filename: "a.png",
      }).mime_type,
    ).toBe("image/png");
    expect(
      validate_product_image({
        buffer: webp,
        mime_type: "image/webp",
        filename: "a.webp",
      }).mime_type,
    ).toBe("image/webp");
  });

  it("unsupported format is rejected", async () => {
    const gif = Buffer.from("GIF89a........");
    expect(() =>
      validate_product_image({
        buffer: gif,
        mime_type: "image/gif",
        filename: "x.gif",
      }),
    ).toThrow("Допустимы только JPG, PNG и WebP");
  });

  it("file larger than 5 MB is rejected", async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    expect(() =>
      validate_product_image({
        buffer: huge,
        mime_type: "image/jpeg",
        filename: "big.jpg",
      }),
    ).toThrow("Размер файла не должен превышать 5 МБ");
  });

  it("corrupted file is rejected", async () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    await expect(
      upload_product_image(director_payload, product_id, {
        buffer: broken,
        mime_type: "image/jpeg",
        filename: "broken.jpg",
      }),
    ).rejects.toMatchObject({
      message: "Файл повреждён или имеет неподдерживаемый формат",
    });
  });

  it("stored filename is safe uuid webp path", async () => {
    const jpeg = await make_image("jpeg");
    const result = await upload_product_image(director_payload, product_id, {
      buffer: jpeg,
      mime_type: "image/jpeg",
      filename: "../../evil.exe.jpg",
    });
    expect(result.image_url).not.toContain("evil");
    expect(result.image_url).not.toContain("..");
    expect(result.image_url.endsWith(".webp")).toBe(true);
  });

  it("replace updates image_url and deletes old file after success", async () => {
    clear_memory_product_image_store();
    const first = await upload_product_image(director_payload, product_id, {
      buffer: await make_image("jpeg"),
      mime_type: "image/jpeg",
      filename: "one.jpg",
    });
    const first_key = first.image_url.replace("/uploads/", "");
    expect(get_memory_product_image_store().has(first_key)).toBe(true);

    const second = await upload_product_image(director_payload, product_id, {
      buffer: await make_image("png"),
      mime_type: "image/png",
      filename: "two.png",
    });
    const second_key = second.image_url.replace("/uploads/", "");

    expect(second.image_url).not.toBe(first.image_url);
    const stored = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
    });
    expect(stored.image_url).toBe(second.image_url);
    expect(get_memory_product_image_store().has(first_key)).toBe(false);
    expect(get_memory_product_image_store().has(second_key)).toBe(true);
  });

  it("failed replace keeps old image", async () => {
    set_product_image_storage_for_tests(memory_driver());
    clear_memory_product_image_store();
    const first = await upload_product_image(director_payload, product_id, {
      buffer: await make_image("jpeg"),
      mime_type: "image/jpeg",
      filename: "keep.jpg",
    });
    const first_key = first.image_url.replace("/uploads/", "");
    expect(get_memory_product_image_store().has(first_key)).toBe(true);

    set_product_image_storage_for_tests({
      async put() {
        throw new Error("forced storage failure");
      },
      async delete(storage_key) {
        get_memory_product_image_store().delete(storage_key);
      },
      build_public_url(storage_key) {
        return `/uploads/${storage_key}`;
      },
    });

    await expect(
      upload_product_image(director_payload, product_id, {
        buffer: await make_image("png"),
        mime_type: "image/png",
        filename: "fail.png",
      }),
    ).rejects.toMatchObject({
      message: "Не удалось загрузить изображение",
    });

    const stored = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
    });
    expect(stored.image_url).toBe(first.image_url);
    expect(get_memory_product_image_store().has(first_key)).toBe(true);
  });

  it("delete sets image_url to null", async () => {
    set_product_image_storage_for_tests(memory_driver());
    await upload_product_image(director_payload, product_id, {
      buffer: await make_image("webp"),
      mime_type: "image/webp",
      filename: "del.webp",
    });
    const result = await remove_product_image(director_payload, product_id);
    expect(result.image_url).toBeNull();
    const stored = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
    });
    expect(stored.image_url).toBeNull();
  });

  it("deactivated product is hidden from client API and reactivation restores it", async () => {
    await deactivate_product(director_payload, product_id);
    let list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 100,
      sort: "name_asc",
      q: suffix,
    });
    expect(list.items.map((item) => item.id)).not.toContain(product_id);

    await activate_product(director_payload, product_id);
    list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 100,
      sort: "name_asc",
      q: suffix,
    });
    expect(list.items.map((item) => item.id)).toContain(product_id);
  });

  it("deactivated category hides products from client", async () => {
    await update_category(director_payload, category_id, { is_active: false });
    const list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 100,
      sort: "name_asc",
      q: suffix,
    });
    expect(list.items.map((item) => item.id)).not.toContain(product_id);
    await update_category(director_payload, category_id, { is_active: true });
  });

  it("order_items stay unchanged after product deactivation", async () => {
    const product = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
    });
    const client = await prisma.clients.findUniqueOrThrow({
      where: { id: approved_client.client!.id },
    });
    const order = await prisma.orders.create({
      data: {
        number: `T-TEST-${suffix}`,
        client_id: client.id,
        created_by_user_id: approved_client.user.id,
        city_id: client.city_id,
        status: "new",
        address_snapshot: "addr",
        contact_name: "n",
        contact_phone: "+79001234567",
        payment_method: "cash",
        desired_delivery_date: new Date("2030-01-01"),
        items: {
          create: [
            {
              product_id: product.id,
              product_name: product.name,
              product_sku: product.sku,
              package_info: "1 шт",
              sale_unit: product.sale_unit,
              qty: 2,
            },
          ],
        },
      },
      include: { items: true },
    });
    cleanup_order_ids.push(order.id);
    const item_before = order.items[0]!;

    await deactivate_product(director_payload, product_id);

    const item_after = await prisma.order_items.findUniqueOrThrow({
      where: { id: item_before.id },
    });
    expect(item_after.product_name).toBe(item_before.product_name);
    expect(item_after.product_sku).toBe(item_before.product_sku);
    expect(item_after.qty).toBe(item_before.qty);
    expect(item_after.product_id).toBe(product_id);

    await activate_product(director_payload, product_id);
  });

  it("manager without can_edit_catalog cannot open staff catalog pages", () => {
    expect(resolve_catalog_editor_access(manager_without_right)).toEqual({
      allow: false,
      redirect_to: "/staff/orders",
    });
    expect(resolve_catalog_editor_access(director_payload)).toEqual({
      allow: true,
    });
    expect(resolve_catalog_editor_access(approved_client)).toEqual({
      allow: false,
      redirect_to: "/catalog",
    });
  });

  it("staff and approved clients see wholesale price; public catalog does not", async () => {
    const updated = await update_product(director_payload, product_id, {
      name: `Фото товар ${suffix}`,
    });
    expect(updated.product).toHaveProperty("price");
    expect(updated.product).toHaveProperty("price_amount");
    expect(updated.product).not.toHaveProperty("purchase_price");
    expect(updated.product).not.toHaveProperty("cost_price");

    const approved_list = await list_catalog_products(approved_client, {
      page: 1,
      page_size: 5,
      sort: "name_asc",
      q: suffix,
    });
    for (const item of approved_list.items) {
      expect(item).toHaveProperty("price");
      expect(item).not.toHaveProperty("price_amount");
      expect(item).not.toHaveProperty("purchase_price");
    }

    const public_list = await list_catalog_products(null, {
      page: 1,
      page_size: 5,
      sort: "name_asc",
      q: suffix,
    });
    for (const item of public_list.items) {
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("price_amount");
      expect(JSON.stringify(item)).not.toMatch(/price/i);
    }
  });
});
