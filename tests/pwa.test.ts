import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import {
  is_never_cache_path,
  is_static_asset_path,
  PRECACHE_URLS,
  should_cache_same_origin_get,
} from "@/lib/pwa/cache-policy";
import {
  detect_is_ios,
  detect_is_standalone,
  should_show_install_prompt,
} from "@/lib/pwa/install-prompt";

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tindagrupp.ru";

describe("PWA manifest", () => {
  it("exposes required fields and start_url /login", () => {
    const data = manifest();
    expect(data.name).toBe("ТИНДА");
    expect(data.short_name).toBe("ТИНДА");
    expect(data.description).toBe("Оптовые поставки напитков и продуктов");
    expect(data.start_url).toBe("/login");
    expect(data.scope).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.orientation).toBe("portrait");
    expect(data.lang).toBe("ru");
    expect(data.background_color).toBe("#f8fafc");
    expect(data.theme_color).toBe("#0f766e");
    expect(data.icons?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("PWA icons", () => {
  const icons = [
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/icon-512-maskable.png",
    "public/icons/apple-touch-icon.png",
    "public/favicon.png",
  ];

  it.each(icons)("%s exists and is a PNG", (rel) => {
    const file = path.join(ROOT, rel);
    expect(fs.existsSync(file)).toBe(true);
    const buf = fs.readFileSync(file);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });
});

describe("PWA offline cache policy", () => {
  it("never caches API or personal pages", () => {
    const blocked = [
      "/api/v1/health",
      "/api/v1/auth/login",
      "/api/v1/cart",
      "/api/v1/staff/orders",
      "/login",
      "/login?next=/catalog",
      "/cart",
      "/checkout",
      "/checkout/success/1",
      "/orders",
      "/orders/abc",
      "/staff",
      "/staff/orders",
      "/profile",
      "/register",
    ];
    for (const p of blocked) {
      expect(is_never_cache_path(p)).toBe(true);
      expect(should_cache_same_origin_get(`${ORIGIN}${p}`, ORIGIN)).toBe(false);
    }
  });

  it("allows only safe static assets and offline page", () => {
    expect(is_static_asset_path("/_next/static/chunks/app.js")).toBe(true);
    expect(is_static_asset_path("/icons/icon-192.png")).toBe(true);
    expect(is_static_asset_path("/manifest.webmanifest")).toBe(true);
    expect(is_static_asset_path("/favicon.png")).toBe(true);
    expect(is_static_asset_path("/catalog")).toBe(false);

    expect(
      should_cache_same_origin_get(`${ORIGIN}/icons/icon-512.png`, ORIGIN),
    ).toBe(true);
    expect(should_cache_same_origin_get(`${ORIGIN}/offline`, ORIGIN)).toBe(
      true,
    );
    expect(
      should_cache_same_origin_get(`${ORIGIN}/_next/static/css/app.css`, ORIGIN),
    ).toBe(true);
    expect(should_cache_same_origin_get(`${ORIGIN}/catalog`, ORIGIN)).toBe(
      false,
    );
    expect(
      should_cache_same_origin_get(`${ORIGIN}/icons/icon-192.png`, ORIGIN, "POST"),
    ).toBe(false);
  });

  it("precache list excludes personal routes", () => {
    for (const url of PRECACHE_URLS) {
      expect(is_never_cache_path(url)).toBe(false);
    }
  });

  it("keeps public/sw.js never-cache prefixes in sync", () => {
    const sw = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
    for (const prefix of [
      "/api",
      "/login",
      "/register",
      "/cart",
      "/checkout",
      "/orders",
      "/staff",
      "/profile",
    ]) {
      expect(sw).toContain(`"${prefix}"`);
    }
  });
});

describe("PWA install prompt visibility", () => {
  it("hides prompt inside an installed standalone app", () => {
    expect(
      should_show_install_prompt({
        can_install: true,
        is_standalone: true,
        is_ios: false,
      }),
    ).toBe(false);
    expect(
      should_show_install_prompt({
        can_install: false,
        is_standalone: true,
        is_ios: true,
      }),
    ).toBe(false);
  });

  it("shows for Android beforeinstallprompt and iOS Safari tips", () => {
    expect(
      should_show_install_prompt({
        can_install: true,
        is_standalone: false,
        is_ios: false,
      }),
    ).toBe(true);
    expect(
      should_show_install_prompt({
        can_install: false,
        is_standalone: false,
        is_ios: true,
      }),
    ).toBe(true);
    expect(
      should_show_install_prompt({
        can_install: false,
        is_standalone: false,
        is_ios: false,
      }),
    ).toBe(false);
  });

  it("detects standalone and iOS user agents", () => {
    expect(detect_is_standalone(() => false, true)).toBe(true);
    expect(
      detect_is_standalone((q) => q === "(display-mode: standalone)", false),
    ).toBe(true);
    expect(detect_is_standalone(() => false, false)).toBe(false);
    expect(
      detect_is_ios(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe(true);
    expect(
      detect_is_ios(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0",
      ),
    ).toBe(false);
  });
});
