import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  DEFAULT_UPLOADS_GID,
  DEFAULT_UPLOADS_UID,
  ensure_local_upload_ownership,
  get_uploads_owner,
  process_can_chown_uploads,
  resolve_local_upload_path,
} from "@/lib/storage/product-images";
import nextConfig from "../next.config";

describe("local upload ownership and path safety", () => {
  const previous = {
    UPLOADS_DIR: process.env.UPLOADS_DIR,
    UPLOADS_UID: process.env.UPLOADS_UID,
    UPLOADS_GID: process.env.UPLOADS_GID,
  };
  let temp_root: string | null = null;

  afterEach(async () => {
    if (previous.UPLOADS_DIR === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous.UPLOADS_DIR;
    if (previous.UPLOADS_UID === undefined) delete process.env.UPLOADS_UID;
    else process.env.UPLOADS_UID = previous.UPLOADS_UID;
    if (previous.UPLOADS_GID === undefined) delete process.env.UPLOADS_GID;
    else process.env.UPLOADS_GID = previous.UPLOADS_GID;

    if (temp_root) {
      await rm(temp_root, { recursive: true, force: true });
      temp_root = null;
    }
  });

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

  it("rejects path traversal outside uploads root", async () => {
    temp_root = await mkdtemp(path.join(os.tmpdir(), "tinda-uploads-"));
    process.env.UPLOADS_DIR = temp_root;
    expect(resolve_local_upload_path("../escape.txt")).toBeNull();
    expect(resolve_local_upload_path("products/ok.webp")).toBe(
      path.join(temp_root, "products/ok.webp"),
    );
  });

  it("ensure_local_upload_ownership no-ops when process cannot chown", async () => {
    temp_root = await mkdtemp(path.join(os.tmpdir(), "tinda-uploads-"));
    process.env.UPLOADS_DIR = temp_root;
    const file = path.join(temp_root, "products", "a.webp");
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
      // File remains readable for the app/nginx even without chown.
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
});
