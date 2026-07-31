import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const UA = "TINDA-ImportBot/1.0 (+https://tindamarket.ru; catalog research)";

export const ALLOWED_HOSTS = new Set([
  "www.bavaria-group.ru",
  "bavaria-group.ru",
  "tbau.ru",
  "www.tbau.ru",
  "tbauwater.com",
  "www.tbauwater.com",
]);

export class RateLimitedClient {
  private last_at = 0;
  private min_interval_ms: number;
  private cookie = "";
  private cache_dir: string;

  constructor(options: { min_interval_ms?: number; cache_dir: string }) {
    this.min_interval_ms = options.min_interval_ms ?? 700;
    this.cache_dir = options.cache_dir;
    mkdirSync(this.cache_dir, { recursive: true });
  }

  private cache_path(url: string): string {
    const safe = Buffer.from(url).toString("base64url");
    return path.join(this.cache_dir, `${safe}.html`);
  }

  private async throttle() {
    const now = Date.now();
    const wait = this.min_interval_ms - (now - this.last_at);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last_at = Date.now();
  }

  async fetch_text(url: string, options: { bypass_cache?: boolean } = {}): Promise<string> {
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.has(host)) {
      throw new Error(`Host not allowed: ${host}`);
    }

    const cached = this.cache_path(url);
    if (!options.bypass_cache && existsSync(cached)) {
      return readFileSync(cached, "utf8");
    }

    let attempt = 0;
    while (attempt < 4) {
      attempt += 1;
      await this.throttle();
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,*/*",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            Cookie: this.cookie,
            Referer: "https://www.bavaria-group.ru/",
          },
          redirect: "follow",
        });
        const set_cookie = res.headers.getSetCookie?.() || [];
        if (set_cookie.length) {
          const parts = set_cookie.map((c) => c.split(";")[0]);
          this.cookie = [...new Set([...(this.cookie ? this.cookie.split("; ") : []), ...parts])].join("; ");
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const text = await res.text();
        writeFileSync(cached, text, "utf8");
        return text;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw new Error(`Failed to fetch ${url}`);
  }

  async confirm_age(base = "https://www.bavaria-group.ru"): Promise<void> {
    const home = await this.fetch_text(`${base}/`, { bypass_cache: true });
    const csrf =
      home.match(/name="csrf-token" content="([^"]+)"/)?.[1] ||
      home.match(/csrf-token" content="([^"]+)"/)?.[1];
    await this.throttle();
    const body = csrf
      ? new URLSearchParams({ "_csrf-frontend": csrf }).toString()
      : "";
    const res = await fetch(`${base}/age-agreement-confirm`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookie,
        Referer: `${base}/`,
      },
      body,
      redirect: "follow",
    });
    const set_cookie = res.headers.getSetCookie?.() || [];
    if (set_cookie.length) {
      const parts = set_cookie.map((c) => c.split(";")[0]);
      this.cookie = [...new Set([...(this.cookie ? this.cookie.split("; ") : []), ...parts])].join("; ");
    }
  }
}
