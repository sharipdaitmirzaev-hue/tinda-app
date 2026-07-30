import { prisma } from "../src/lib/db";

async function main() {
  await prisma.product_interest_requests.deleteMany();
  await prisma.cart_items.deleteMany();
  await prisma.carts.deleteMany();
  await prisma.order_items.deleteMany();
  await prisma.order_status_history.deleteMany();
  await prisma.order_idempotency_keys.deleteMany();
  await prisma.orders.deleteMany();
  await prisma.products.deleteMany();
  console.log("products", await prisma.products.count());
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
