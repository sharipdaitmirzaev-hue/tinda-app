import { expect, type Page } from "@playwright/test";

export const SEED_PASSWORD = process.env.SEED_PASSWORD || "ChangeMe123!";

export async function login(page: Page, login: string, password = SEED_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel(/почта|телефон|логин|email/i).fill(login);
  await page.getByLabel(/^пароль$/i).fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    }),
    page.getByRole("button", { name: /войти/i }).click(),
  ]);
}

/**
 * Города грузятся асинхронно через /api/v1/cities.
 * Без ожидания selectOption({ index: 1 }) падает: в select есть только
 * placeholder «Выберите город».
 */
export async function select_first_city(page: Page) {
  const city = page.locator("#city_id");
  await expect(city).toBeVisible();
  await expect
    .poll(async () => city.locator("option").count(), {
      timeout: 15_000,
      message:
        "Города не загрузились в #city_id (ожидался ответ /api/v1/cities)",
    })
    .toBeGreaterThan(1);
  const value = await city.locator("option").nth(1).getAttribute("value");
  expect(value, "У первой доступной опции города должен быть value").toBeTruthy();
  await city.selectOption(value!);
}

export async function expect_redirect_away_from(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(page.url()).not.toContain(path);
}

export function unique_inn(): string {
  return `${Date.now()}`.slice(-10).padStart(10, "0");
}
