#!/usr/bin/env node
/**
 * Local gallery server for Zelenoe Yabloko image review.
 *
 * Serves static files from data/imports/zelenoe-yabloko-images
 * and saves review-decisions.json / .xlsx via POST /api/decisions.
 *
 * Does NOT change production / VPS / DB / image_url.
 */
import { createRequire } from "node:module";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

const ROOT = path.resolve(
  arg("root", "data/imports/zelenoe-yabloko-images")!,
);
const PORT = Number(arg("port", "8765"));
const JSON_PATH = path.join(ROOT, "review-decisions.json");
const XLSX_PATH = path.join(ROOT, "review-decisions.xlsx");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function ensure_gallery_built() {
  const gallery = path.join(ROOT, "gallery.html");
  const data = path.join(ROOT, "gallery-data.json");
  if (existsSync(gallery) && existsSync(data)) return;
  console.error("[zy-gallery] building gallery…");
  const r = spawnSync(
    "npx",
    ["tsx", "scripts/zelenoe-yabloko/build-gallery.ts", "--out-dir", ROOT],
    { stdio: "inherit", cwd: path.resolve(".") },
  );
  if (r.status !== 0) {
    throw new Error("Failed to build gallery");
  }
}

function read_body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function write_decisions(payload: {
  generated_at?: string;
  note?: string;
  items: Array<Record<string, unknown>>;
}) {
  mkdirSync(ROOT, { recursive: true });
  const items = payload.items || [];
  const doc = {
    generated_at: payload.generated_at || new Date().toISOString(),
    note:
      payload.note ||
      "Local decisions only. No production / VPS / image_url changes.",
    items,
  };
  writeFileSync(JSON_PATH, JSON.stringify(doc, null, 2));

  const sheet_rows = items.map((r) => ({
    source_index: r.source_index ?? "",
    source_name: r.source_name ?? "",
    source_product_url: r.source_product_url ?? "",
    candidate_image_url: r.candidate_image_url ?? "",
    local_original_path: r.local_original_path ?? "",
    preview_path: r.preview_path ?? "",
    match_status: r.match_status ?? "",
    match_score: r.match_score ?? "",
    tinda_product_id: r.tinda_product_id ?? "",
    tinda_sku: r.tinda_sku ?? "",
    tinda_name: r.tinda_name ?? "",
    review_status: r.review_status ?? "pending",
    review_comment: r.review_comment ?? "",
    width: r.width ?? "",
    height: r.height ?? "",
    sha256: r.sha256 ?? "",
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sheet_rows),
    "Решения",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        step: 1,
        text: "Локальный review. Не загружать на VPS и не менять image_url автоматически.",
      },
      {
        step: 2,
        text: "review_status: pending | approved_existing | approved_new | rejected",
      },
    ]),
    "Инструкция",
  );
  XLSX.writeFile(wb, XLSX_PATH);

  return {
    ok: true,
    json_path: JSON_PATH,
    xlsx_path: XLSX_PATH,
    count: items.length,
  };
}

function safe_join(root: string, url_path: string): string | null {
  const decoded = decodeURIComponent(url_path.split("?")[0] || "/");
  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(root, rel || "gallery.html");
  if (!abs.startsWith(path.resolve(root))) return null;
  return abs;
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "POST" && url.pathname === "/api/decisions") {
    try {
      const raw = await read_body(req);
      const payload = JSON.parse(raw);
      const result = write_decisions(payload);
      send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
    } catch (e) {
      send(
        res,
        400,
        JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        }),
        "application/json; charset=utf-8",
      );
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/decisions") {
    if (!existsSync(JSON_PATH)) {
      send(
        res,
        200,
        JSON.stringify({ items: [] }),
        "application/json; charset=utf-8",
      );
      return;
    }
    send(
      res,
      200,
      readFileSync(JSON_PATH),
      "application/json; charset=utf-8",
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/decisions.json") {
    if (!existsSync(JSON_PATH)) {
      send(res, 404, "not found", "text/plain");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="review-decisions.json"',
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(JSON_PATH));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/decisions.xlsx") {
    if (!existsSync(XLSX_PATH)) {
      send(res, 404, "not found", "text/plain");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[".xlsx"],
      "Content-Disposition":
        'attachment; filename="review-decisions.xlsx"',
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(XLSX_PATH));
    return;
  }

  let req_path = url.pathname;
  if (req_path === "/") req_path = "/gallery.html";
  const abs = safe_join(ROOT, req_path);
  if (!abs || !existsSync(abs) || statSync(abs).isDirectory()) {
    send(res, 404, "Not found", "text/plain");
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  send(res, 200, readFileSync(abs), MIME[ext] || "application/octet-stream");
}

ensure_gallery_built();
createServer((req, res) => {
  handler(req, res).catch((e) => {
    send(
      res,
      500,
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      "application/json",
    );
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(
    JSON.stringify(
      {
        serving: ROOT,
        url: `http://127.0.0.1:${PORT}/gallery.html`,
        decisions_json: JSON_PATH,
        decisions_xlsx: XLSX_PATH,
        production_changed: false,
      },
      null,
      2,
    ),
  );
});
