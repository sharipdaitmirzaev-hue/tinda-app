import { expect, test } from "@playwright/test";
import { login, unique_inn } from "./helpers";

test.describe.configure({ mode: "serial" });

const suffix = Date.now();
const client_email = `e2e_client_${suffix}@example.com`;
const client_password = "Password1!";
let order_number = "";

test("сценарий 1: регистрация → pending → approve → каталог", async ({
  page,
  context,
}) => {
  await page.goto("/register");
  await page.getByLabel("Название компании / точки").fill(`E2E Компания ${suffix}`);
  await page.getByLabel("ИНН", { exact: true }).fill(unique_inn());
  await page.locator("#city_id").selectOption({ index: 1 });
  await page.getByLabel("Адрес точки / доставки").fill("Махачкала, тест");
  await page.getByLabel("Контактное лицо").fill("E2E Клиент");
  await page.getByLabel("Телефон", { exact: true }).fill("+79281234567");
  await page.getByLabel("Эл. почта").fill(client_email);
  await page.getByLabel("Пароль", { exact: true }).fill(client_password);
  await page.getByLabel("Подтверждение пароля").fill(client_password);
  await page.getByText(/согласен на обработку персональных данных/i).click();
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(page).toHaveURL(/\/pending/);
  await expect(page.getByText(/на рассмотрении/i)).toBeVisible();

  await context.clearCookies();
  await login(page, "manager1@tinda.local");
  await expect(page).toHaveURL(/\/staff\/orders/);
  await page.goto("/staff/registration-requests");
  await page
    .getByRole("link", { name: new RegExp(`E2E Компания ${suffix}`) })
    .click();
  await page.getByRole("button", { name: "Подтвердить клиента" }).click();
  await expect(page).toHaveURL(/registration-requests/);

  await context.clearCookies();
  await login(page, client_email, client_password);
  await expect(page).toHaveURL(/\/catalog/);
  await expect(page.getByText("ТИНДА").first()).toBeVisible();
});

test("сценарий 2: корзина → checkout → успех → история", async ({ page }) => {
  await login(page, client_email, client_password);
  await page.goto("/catalog");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/cart");
  await page.getByRole("link", { name: /оформить заказ/i }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByText("Адрес доставки").locator("..").locator("textarea").fill(
    "Махачкала, ул. Тестовая, 1",
  );
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getDate()).padStart(2, "0");
  await page.locator('input[type="date"]').fill(`${yyyy}-${mm}-${dd}`);
  await page
    .getByText("Контактное лицо", { exact: true })
    .locator("..")
    .locator("input")
    .fill("E2E Клиент");
  await page
    .getByText("Телефон", { exact: true })
    .locator("..")
    .locator('input[type="tel"]')
    .fill("+79281234567");
  await page.getByLabel("Безналичная оплата по счёту").check();
  await page.getByRole("button", { name: "Отправить заказ" }).click();
  await expect(page).toHaveURL(/\/checkout\/success\//, { timeout: 20_000 });
  await expect(page.getByText("Заказ отправлен")).toBeVisible();
  const number_el = page.locator("text=/T-\\d{8}-\\d{6}/").first();
  await expect(number_el).toBeVisible();
  order_number = ((await number_el.textContent()) || "").trim();

  await page.goto("/orders");
  await expect(page.getByText(order_number)).toBeVisible();
});

test("сценарий 3: manager confirm → delivered", async ({ page, context }) => {
  test.skip(!order_number, "order from scenario 2 required");

  await login(page, "manager1@tinda.local");
  await page.goto("/staff/orders");
  await page.getByRole("link", { name: order_number }).first().click();
  await page.getByRole("button", { name: "Подтвердить заказ" }).first().click();
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByText("Подтверждён").first()).toBeVisible();

  await page.getByRole("button", { name: "Доставлен" }).first().click();
  await page.getByRole("button", { name: "Да, доставлен" }).click();
  await expect(page.getByText("Доставлен").first()).toBeVisible();

  await context.clearCookies();
  await login(page, client_email, client_password);
  await page.goto("/orders");
  await page.getByRole("link", { name: order_number }).first().click();
  await expect(page.getByText("Доставлен").first()).toBeVisible();
});

test("сценарий 4: manager без can_edit_catalog не открывает товары", async ({
  page,
}) => {
  await login(page, "manager2@tinda.local");
  await page.goto("/staff/products");
  await expect(page).toHaveURL(/\/staff\/orders/);
  await expect(page.getByRole("link", { name: "Товары" })).toHaveCount(0);
});

test("сценарий 5: client не staff; manager не client cart", async ({
  page,
  context,
}) => {
  await login(page, client_email, client_password);
  await page.goto("/staff/orders");
  await expect(page).not.toHaveURL(/\/staff\//);

  await context.clearCookies();
  await login(page, "manager1@tinda.local");
  await page.goto("/cart");
  await expect(page).toHaveURL(/\/staff\//);
});
