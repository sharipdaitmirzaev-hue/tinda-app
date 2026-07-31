import { afterEach, describe, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "fs/promises";
import os from "os";
import path from "path";
import {
  DEFAULT_UPLOADS_GID,
  DEFAULT_UPLOADS_UID,
  UPLOADS_DIR_MODE,
  UPLOADS_FILE_MODE,
  ensure_local_upload_ownership,
  get_product_image_storage,
  get_uploads_owner,
  process_can_chown_uploads,
  resolve_existing_local_upload_file,
  resolve_local_upload_path,
  set_product_image_storage_for_tests,
} from "@/lib/storage/product-images";
import {
  content_type_for_upload,
  serve_local_upload_response,
  storage_key_from_upload_parts,
} from "@/lib/storage/serve-local-upload";
import nextConfig from "../next.config";

describe("local upload ownership and path safety", () => {
  const previous = {
    UPLOADS_DIR: process.env.UPLOADS_DIR,
    UPLOADS_UID: process.env.UPLOADS_UID,
    UPLOADS_GID: process.env.UPLOADS_GID,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
  };
  let temp_root: string | null = null;

  afterEach(async () => {
    set_product_image_storage_for_tests(null);
    if (previous.UPLOADS_DIR === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous.UPLOADS_DIR;
    if (previous.UPLOADS_UID === undefined) delete process.env.UPLOADS_UID;
    else process.env.UPLOADS_UID = previous.UPLOADS_UID;
    if (previous.UPLOADS_GID === undefined) delete process.env.UPLOADS_GID;
    else process.env.UPLOADS_GID = previous.UPLOADS_GID;
    if (previous.STORAGE_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = previous.STORAGE_DRIVER;

    if (temp_root) {
      await rm(temp_root, { recursive: true, force: true });
      temp_root = null;
    }
  });

  async function with_temp_uploads(): Promise<string> {
    temp_root = await mkdtemp(path.join(os.tmpdir(), "tinda-uploads-"));
    process.env.UPLOADS_DIR = temp_root;
    process.env.STORAGE_DRIVER = "local";
    return temp_root;
  }

  it("defaults uploads owner to nextjs uid/gid 1001:1001", () => {
    delete process.env.UPLOADS_UID;
    delete process.env.UPLOADS_GID;
    expect(get_uploads_owner()).toEqual({
      uid: DEFAULT_UPLOADS_UID,
      gid: DEFAULT_UPLOADS_GID,
    });
  });

  it("respects UPLOADS_UID / UPLOADS_GID overrides", () => {
    process.env.UPLOADS_UID = "2002";
    process.env.UPLOADS_GID = "2003";
    expect(get_uploads_owner()).toEqual({ uid: 2002, gid: 2003 });
  });

  it("rejects path traversal and absolute/null-byte keys", async () => {
    const root = await with_temp_uploads();
    expect(resolve_local_upload_path("../escape.txt")).toBeNull();
    expect(resolve_local_upload_path("..\\escape.txt")).toBeNull();
    expect(resolve_local_upload_path("/etc/passwd")).toBeNull();
    expect(resolve_local_upload_path("products/\0evil.webp")).toBeNull();
    expect(resolve_local_upload_path("products/../../etc/passwd")).toBeNull();
    expect(resolve_local_upload_path("products/ok.webp")).toBe(
      path.join(root, "products/ok.webp"),
    );
  });

  it("rejects encoded traversal segments before join", () => {
    expect(storage_key_from_upload_parts([".."])).toBeNull();
    expect(storage_key_from_upload_parts(["%2e%2e"])).toBeNull();
    expect(storage_key_from_upload_parts(["products", "%2e%2e", "x"])).toBeNull();
    expect(storage_key_from_upload_parts(["products", "a%2fb.webp"])).toBeNull();
    expect(
      storage_key_from_upload_parts([
        "products",
        "11111111-1111-1111-1111-111111111111",
        "a.webp",
      ]),
    ).toBe(
      "products/11111111-1111-1111-1111-111111111111/a.webp",
    );
  });

  it("rejects symlink escape outside uploads root", async () => {
    const root = await with_temp_uploads();
    const outside = await mkdtemp(path.join(os.tmpdir(), "tinda-outside-"));
    try {
      const secret = path.join(outside, "secret.txt");
      await writeFile(secret, "top-secret");
      const link = path.join(root, "products", "leak.webp");
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(secret, link);

      expect(await resolve_existing_local_upload_file("products/leak.webp")).toBeNull();
      const res = await serve_local_upload_response([
        "products",
        "leak.webp",
      ]);
      expect(res.status).toBe(404);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("serves existing file with MIME, 404 for missing/dir, no listing", async () => {
    const root = await with_temp_uploads();
    const file = path.join(
      root,
      "products",
      "11111111-1111-1111-1111-111111111111",
      "a.webp",
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from("RIFFWEBP"));

    const ok = await serve_local_upload_response([
      "products",
      "11111111-1111-1111-1111-111111111111",
      "a.webp",
    ]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/webp");
    expect(ok.headers.get("Content-Length")).toBe("8");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = Buffer.from(await ok.arrayBuffer());
    expect(body.toString()).toBe("RIFFWEBP");

    const missing = await serve_local_upload_response([
      "products",
      "missing.webp",
    ]);
    expect(missing.status).toBe(404);

    const dir = await serve_local_upload_response(["products"]);
    expect(dir.status).toBe(404);
    expect(await dir.text()).toBe("Not Found");

    const empty = await serve_local_upload_response([]);
    expect(empty.status).toBe(404);

    expect(content_type_for_upload("x.png")).toBe("image/png");
    expect(content_type_for_upload("x.jpg")).toBe("image/jpeg");
    expect(content_type_for_upload("x.bin")).toBe("application/octet-stream");
  });

  it("local put creates safe modes and optional root chown", async () => {
    const root = await with_temp_uploads();
    const storage = get_product_image_storage();
    const key = "products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b.webp";
    await storage.put(key, Buffer.from("webp-bytes"), "image/webp");

    const absolute = path.join(root, key);
    const file_info = await stat(absolute);
    expect(file_info.isFile()).toBe(true);
    expect(file_info.mode & 0o777).toBe(UPLOADS_FILE_MODE);

    const dir_info = await stat(path.dirname(absolute));
    // mkdir recursive mode may be masked by umask; require no world-write.
    expect(dir_info.mode & 0o002).toBe(0);
    expect(dir_info.mode & UPLOADS_DIR_MODE).toBeTruthy();

    const owned = await ensure_local_upload_ownership(absolute);
    if (process_can_chown_uploads()) {
      expect(owned.adjusted).toBe(true);
      expect((await stat(absolute)).uid).toBe(DEFAULT_UPLOADS_UID);
      expect((await stat(absolute)).gid).toBe(DEFAULT_UPLOADS_GID);
    } else {
      expect(owned.adjusted).toBe(false);
    }

    // Compatibility: same public URL shape.
    expect(storage.build_public_url(key)).toBe(`/uploads/${key}`);
  });

  it("ensure_local_upload_ownership no-ops when process cannot chown", async () => {
    const root = await with_temp_uploads();
    const file = path.join(root, "products", "a.webp");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from("RIFF"));

    const result = await ensure_local_upload_ownership(file);
    if (process_can_chown_uploads()) {
      expect(result.adjusted).toBe(true);
      expect(result.uid).toBe(DEFAULT_UPLOADS_UID);
      expect(result.gid).toBe(DEFAULT_UPLOADS_GID);
      const info = await stat(file);
      expect(info.uid).toBe(DEFAULT_UPLOADS_UID);
      expect(info.gid).toBe(DEFAULT_UPLOADS_GID);
    } else {
      expect(result.adjusted).toBe(false);
      await chmod(file, 0o644);
      expect((await readFile(file)).toString()).toBe("RIFF");
    }
  });

  it("next.config rewrites /uploads to live /api/uploads handler", async () => {
    const rewrites = nextConfig.rewrites;
    expect(typeof rewrites).toBe("function");
    const result = await rewrites!();
    const before =
      result && !Array.isArray(result) ? result.beforeFiles || [] : [];
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/uploads/:path*",
          destination: "/api/uploads/:path*",
        }),
      ]),
    );
  });

  it("realpath of normal file stays inside uploads root", async () => {
    const root = await with_temp_uploads();
    const key = "products/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/c.png";
    const absolute = path.join(root, key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, Buffer.from("png"));
    const resolved = await resolve_existing_local_upload_file(key);
    expect(resolved).toBe(await realpath(absolute));
    expect((await lstat(absolute)).isSymbolicLink()).toBe(false);
  });
});
