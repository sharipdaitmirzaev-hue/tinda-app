import { describe, expect, it, afterEach } from "vitest";
import {
  get_app_url,
  get_site_name,
  get_site_tagline,
} from "@/lib/security/env";

const KEYS = [
  "APP_URL",
  "SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "BASE_URL",
  "NEXTAUTH_URL",
  "SITE_NAME",
  "SITE_DESCRIPTION",
] as const;

describe("public site URL helpers", () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  function snap() {
    for (const key of KEYS) prev[key] = process.env[key];
  }

  it("prefers APP_URL and strips trailing slash", () => {
    snap();
    process.env.APP_URL = "https://tindamarket.ru/";
    process.env.SITE_URL = "https://example.com";
    expect(get_app_url()).toBe("https://tindamarket.ru");
  });

  it("falls back through SITE_URL / NEXT_PUBLIC / BASE / NEXTAUTH", () => {
    snap();
    delete process.env.APP_URL;
    process.env.SITE_URL = "https://tindamarket.ru";
    expect(get_app_url()).toBe("https://tindamarket.ru");
    delete process.env.SITE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://tindamarket.ru";
    expect(get_app_url()).toBe("https://tindamarket.ru");
  });

  it("exposes ТИНДА Маркет branding defaults", () => {
    snap();
    delete process.env.SITE_NAME;
    delete process.env.SITE_DESCRIPTION;
    expect(get_site_name()).toBe("ТИНДА Маркет");
    expect(get_site_tagline()).toMatch(/Оптовый каталог/);
  });
});
