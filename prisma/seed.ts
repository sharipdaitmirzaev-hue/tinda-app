import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsert_role(code: string, name: string) {
  return prisma.roles.upsert({
    where: { code },
    update: { name },
    create: { code, name },
  });
}

async function main() {
  const role_client = await upsert_role("client", "Клиент");
  const role_manager = await upsert_role("manager", "Менеджер");
  const role_director = await upsert_role("director", "Руководитель");

  const password_hash = await bcrypt.hash("ChangeMe123!", 10);

  const director = await prisma.users.upsert({
    where: { email: "director@tinda.local" },
    update: {},
    create: {
      email: "director@tinda.local",
      phone: "+79280000001",
      password_hash,
      full_name: "Руководитель ТИНДА",
      user_roles: { create: [{ role_id: role_director.id }] },
      employee_profile: {
        create: {
          can_view_all_clients: true,
          can_edit_catalog: true,
        },
      },
    },
  });

  const manager_one = await prisma.users.upsert({
    where: { email: "manager1@tinda.local" },
    update: {},
    create: {
      email: "manager1@tinda.local",
      phone: "+79280000002",
      password_hash,
      full_name: "Менеджер Один",
      user_roles: { create: [{ role_id: role_manager.id }] },
      employee_profile: {
        create: {
          can_view_all_clients: false,
          can_edit_catalog: true,
        },
      },
    },
  });

  const manager_two = await prisma.users.upsert({
    where: { email: "manager2@tinda.local" },
    update: {},
    create: {
      email: "manager2@tinda.local",
      phone: "+79280000003",
      password_hash,
      full_name: "Менеджер Два",
      user_roles: { create: [{ role_id: role_manager.id }] },
      employee_profile: {
        create: {
          can_view_all_clients: false,
          can_edit_catalog: false,
        },
      },
    },
  });

  const cities_data = [
    { name: "Махачкала", sort_order: 1 },
    { name: "Каспийск", sort_order: 2 },
    { name: "Дербент", sort_order: 3 },
    { name: "Хасавюрт", sort_order: 4 },
    { name: "Буйнакск", sort_order: 5 },
  ];

  for (const city of cities_data) {
    await prisma.cities.upsert({
      where: {
        name_region: {
          name: city.name,
          region: "Республика Дагестан",
        },
      },
      update: { sort_order: city.sort_order, is_active: true },
      create: {
        name: city.name,
        region: "Республика Дагестан",
        sort_order: city.sort_order,
        is_active: true,
      },
    });
  }

  async function ensure_category(
    slug: string,
    name: string,
    parent_id: string | null,
    sort_order: number,
  ) {
    return prisma.categories.upsert({
      where: { slug },
      update: { name, parent_id, sort_order, is_active: true },
      create: { slug, name, parent_id, sort_order, is_active: true },
    });
  }

  const cat_water = await ensure_category("voda", "Вода", null, 1);
  await ensure_category("voda-pitevaya", "Питьевая вода", cat_water.id, 1);
  await ensure_category("voda-mineralnaya", "Минеральная вода", cat_water.id, 2);
  await ensure_category(
    "voda-lechebno-stolovaya",
    "Лечебно-столовая вода",
    cat_water.id,
    3,
  );
  await ensure_category("voda-gazirovannaya", "Газированная вода", cat_water.id, 4);
  await ensure_category(
    "voda-negazirovannaya",
    "Негазированная вода",
    cat_water.id,
    5,
  );

  const cat_juices = await ensure_category(
    "soki-morsy-nektary",
    "Соки, морсы и нектары",
    null,
    2,
  );
  await ensure_category("sok", "Сок", cat_juices.id, 1);
  await ensure_category("nektar", "Нектар", cat_juices.id, 2);
  await ensure_category("mors", "Морс", cat_juices.id, 3);
  await ensure_category("kisel", "Кисель", cat_juices.id, 4);
  await ensure_category("kompot", "Компот", cat_juices.id, 5);

  const cat_soda = await ensure_category(
    "gazirovannye-napitki",
    "Газированные напитки",
    null,
    3,
  );
  await ensure_category("gazirovka", "Газировка", cat_soda.id, 1);
  await ensure_category("limonady", "Лимонады", cat_soda.id, 2);
  await ensure_category("kola", "Кола", cat_soda.id, 3);
  await ensure_category("toniki", "Тоники", cat_soda.id, 4);

  await ensure_category("energeticheskie-napitki", "Энергетические напитки", null, 4);

  const cat_tea_coffee = await ensure_category(
    "kholodnyy-chay-i-kofe",
    "Холодный чай и кофе",
    null,
    5,
  );
  await ensure_category("kholodnyy-chay", "Холодный чай", cat_tea_coffee.id, 1);
  await ensure_category("kholodnyy-kofe", "Холодный кофе", cat_tea_coffee.id, 2);

  await ensure_category("kvas", "Квас", null, 6);

  async function category_id_by_slug(slug: string) {
    const category = await prisma.categories.findUniqueOrThrow({
      where: { slug },
    });
    return category.id;
  }

  const seed_products = [
    {
      sku: "W-001",
      name: "Вода питьевая негазированная 0.5 л",
      brand: "ТИНДА",
      category_slug: "voda-pitevaya",
      volume_text: "0.5 л",
      package_type: "бутылка",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
      is_new: true,
    },
    {
      sku: "W-002",
      name: "Вода питьевая негазированная 1.5 л",
      brand: "ТИНДА",
      category_slug: "voda-pitevaya",
      volume_text: "1.5 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: true,
      availability: "in_stock",
      is_hit: true,
    },
    {
      sku: "W-003",
      name: "Вода минеральная газированная 0.5 л",
      brand: "Каспий",
      category_slug: "voda-mineralnaya",
      volume_text: "0.5 л",
      package_type: "бутылка",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
      is_promo: true,
    },
    {
      sku: "W-004",
      name: "Вода лечебно-столовая 1 л",
      brand: "Дагестан",
      category_slug: "voda-lechebno-stolovaya",
      volume_text: "1 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: false,
      availability: "on_order",
    },
    {
      sku: "J-001",
      name: "Сок яблочный 1 л",
      brand: "Сады",
      category_slug: "sok",
      volume_text: "1 л",
      package_type: "тетрапак",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
      is_new: true,
    },
    {
      sku: "J-002",
      name: "Нектар персиковый 0.95 л",
      brand: "Сады",
      category_slug: "nektar",
      volume_text: "0.95 л",
      package_type: "тетрапак",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
    },
    {
      sku: "J-003",
      name: "Морс клюквенный 1 л",
      brand: "Север",
      category_slug: "mors",
      volume_text: "1 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: true,
      availability: "in_stock",
      is_hit: true,
    },
    {
      sku: "S-001",
      name: "Лимонад классический 0.5 л",
      brand: "Буржуа",
      category_slug: "limonady",
      volume_text: "0.5 л",
      package_type: "бутылка",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
      is_promo: true,
    },
    {
      sku: "S-002",
      name: "Кола 1 л",
      brand: "City Cola",
      category_slug: "kola",
      volume_text: "1 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: false,
      availability: "out_of_stock",
    },
    {
      sku: "E-001",
      name: "Энергетический напиток 0.45 л",
      brand: "Pulse",
      category_slug: "energeticheskie-napitki",
      volume_text: "0.45 л",
      package_type: "банка",
      units_per_package: 24,
      sale_unit: "блок",
      min_order_qty: 24,
      allow_piece_sale: false,
      availability: "in_stock",
      is_new: true,
    },
    {
      sku: "T-001",
      name: "Холодный чай лимон 0.5 л",
      brand: "IceDay",
      category_slug: "kholodnyy-chay",
      volume_text: "0.5 л",
      package_type: "бутылка",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
    },
    {
      sku: "K-001",
      name: "Квас традиционный 1.5 л",
      brand: "Домашний",
      category_slug: "kvas",
      volume_text: "1.5 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: true,
      availability: "in_stock",
      is_hit: true,
    },
  ] as const;

  for (const item of seed_products) {
    const category_id = await category_id_by_slug(item.category_slug);
    await prisma.products.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        brand: item.brand,
        category_id,
        volume_text: item.volume_text,
        package_type: item.package_type,
        units_per_package: item.units_per_package,
        sale_unit: item.sale_unit,
        min_order_qty: item.min_order_qty,
        allow_piece_sale: item.allow_piece_sale,
        availability: item.availability,
        is_promo: "is_promo" in item ? Boolean(item.is_promo) : false,
        is_new: "is_new" in item ? Boolean(item.is_new) : false,
        is_hit: "is_hit" in item ? Boolean(item.is_hit) : false,
        is_active: true,
      },
      create: {
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category_id,
        volume_text: item.volume_text,
        package_type: item.package_type,
        units_per_package: item.units_per_package,
        sale_unit: item.sale_unit,
        min_order_qty: item.min_order_qty,
        allow_piece_sale: item.allow_piece_sale,
        description: "Тестовый товар seed Э1.5",
        availability: item.availability,
        is_promo: "is_promo" in item ? Boolean(item.is_promo) : false,
        is_new: "is_new" in item ? Boolean(item.is_new) : false,
        is_hit: "is_hit" in item ? Boolean(item.is_hit) : false,
        is_active: true,
      },
    });
  }

  await prisma.settings.upsert({
    where: { key: "support_email" },
    update: { value: "support@tinda.ru" },
    create: { key: "support_email", value: "support@tinda.ru" },
  });

  await prisma.settings.upsert({
    where: { key: "support_phone" },
    update: { value: "+7 (8722) 00-00-00" },
    create: { key: "support_phone", value: "+7 (8722) 00-00-00" },
  });

  console.log("Seed OK");
  console.log({
    director_email: director.email,
    manager_one_email: manager_one.email,
    manager_two_email: manager_two.email,
    password: "ChangeMe123!",
    roles: [role_client.code, role_manager.code, role_director.code],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
