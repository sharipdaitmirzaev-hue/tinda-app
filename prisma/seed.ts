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

  const water_pitevaya = await prisma.categories.findUniqueOrThrow({
    where: { slug: "voda-pitevaya" },
  });

  await prisma.products.upsert({
    where: { sku: "W-001" },
    update: {},
    create: {
      sku: "W-001",
      name: "Вода питьевая негазированная 0.5 л",
      brand: "ТИНДА",
      category_id: water_pitevaya.id,
      volume_text: "0.5 л",
      package_type: "бутылка",
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      allow_piece_sale: false,
      description: "Питьевая вода для демо-каталога Э1",
      availability: "in_stock",
      is_new: true,
      is_active: true,
    },
  });

  await prisma.products.upsert({
    where: { sku: "W-002" },
    update: {},
    create: {
      sku: "W-002",
      name: "Вода питьевая негазированная 1.5 л",
      brand: "ТИНДА",
      category_id: water_pitevaya.id,
      volume_text: "1.5 л",
      package_type: "бутылка",
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      allow_piece_sale: true,
      description: "Можно заказывать поштучно",
      availability: "in_stock",
      is_hit: true,
      is_active: true,
    },
  });

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
