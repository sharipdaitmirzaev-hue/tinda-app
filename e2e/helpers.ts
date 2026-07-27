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

export async function expect_redirect_away_from(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(page.url()).not.toContain(path);
}

export function unique_inn(): string {
  return `${Date.now()}`.slice(-10).padStart(10, "0");
}
