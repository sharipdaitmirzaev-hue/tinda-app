import { createHash, randomUUID } from "crypto";
import { chown, mkdir, realpath, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { AppError } from "@/lib/http/errors";

/** Runtime user inside the production app image (Dockerfile `nextjs`). */
export const DEFAULT_UPLOADS_UID = 1001;
export const DEFAULT_UPLOADS_GID = 1001;
/** Safe defaults for newly created upload dirs/files. */
export const UPLOADS_DIR_MODE = 0o755;
export const UPLOADS_FILE_MODE = 0o644;

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_SIDE = 1600;
export const PRODUCT_IMAGE_WEBP_QUALITY = 82;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export type StorageDriverName = "local" | "s3" | "memory";

export type StoredProductImage = {
  storage_key: string;
  image_url: string;
};

export type ProductImageStorageDriver = {
  put(storage_key: string, body: Buffer, content_type: string): Promise<void>;
  delete(storage_key: string): Promise<void>;
  build_public_url(storage_key: string): string;
};

type MemoryStore = Map<string, Buffer>;

const memory_store: MemoryStore = new Map();
let driver_override: ProductImageStorageDriver | null = null;

function get_driver_name(): StorageDriverName {
  const raw = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (raw === "s3" || raw === "local" || raw === "memory") {
    return raw;
  }
  return "local";
}

export function local_uploads_root(): string {
  const from_env = process.env.UPLOADS_DIR?.trim();
  if (from_env) {
    return path.resolve(from_env);
  }
  return path.join(process.cwd(), "public", "uploads");
}

export function get_uploads_owner(): { uid: number; gid: number } {
  const uid_raw = Number.parseInt(
    process.env.UPLOADS_UID || String(DEFAULT_UPLOADS_UID),
    10,
  );
  const gid_raw = Number.parseInt(
    process.env.UPLOADS_GID || String(DEFAULT_UPLOADS_GID),
    10,
  );
  return {
    uid: Number.isFinite(uid_raw) ? uid_raw : DEFAULT_UPLOADS_UID,
    gid: Number.isFinite(gid_raw) ? gid_raw : DEFAULT_UPLOADS_GID,
  };
}

/** True when the process can chown files (typically root in one-shot import containers). */
export function process_can_chown_uploads(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function is_path_inside_root(target: string, root: string): boolean {
  const normalized_root = path.resolve(root);
  const normalized_target = path.resolve(target);
  return (
    normalized_target === normalized_root ||
    normalized_target.startsWith(normalized_root + path.sep)
  );
}

/**
 * Resolve a storage key under the local uploads root, rejecting path traversal.
 * Returns null when the key escapes the root.
 */
export function resolve_local_upload_path(storage_key: string): string | null {
  if (!storage_key || storage_key.includes("\0")) {
    return null;
  }
  // Absolute keys must not bypass the uploads root via path.join semantics.
  if (path.isAbsolute(storage_key)) {
    return null;
  }
  // Normalize Windows separators and reject empty / traversal segments early.
  const normalized_key = storage_key.replace(/\\/g, "/");
  const segments = normalized_key.split("/").filter((s) => s.length > 0);
  if (
    segments.length === 0 ||
    segments.some((s) => s === "." || s === "..")
  ) {
    return null;
  }

  const normalized_root = path.resolve(local_uploads_root());
  const normalized_target = path.resolve(
    path.join(normalized_root, ...segments),
  );
  if (!is_path_inside_root(normalized_target, normalized_root)) {
    return null;
  }
  return normalized_target;
}

/**
 * Resolve an existing upload file for HTTP serving.
 * Uses realpath so symlink escapes outside the uploads root are rejected.
 */
export async function resolve_existing_local_upload_file(
  storage_key: string,
): Promise<string | null> {
  const candidate = resolve_local_upload_path(storage_key);
  if (!candidate) {
    return null;
  }

  try {
    const root_real = await realpath(local_uploads_root());
    const file_real = await realpath(candidate);
    if (!is_path_inside_root(file_real, root_real)) {
      return null;
    }
    return file_real;
  } catch {
    return null;
  }
}

/**
 * When running as root, chown the file and parent dirs under the uploads root
 * to the app user (default 1001:1001) so the Next.js process can manage them
 * and imports do not leave root-owned files requiring a manual host chown.
 */
export async function ensure_local_upload_ownership(
  absolute_path: string,
): Promise<{ adjusted: boolean; uid: number; gid: number }> {
  const { uid, gid } = get_uploads_owner();
  if (!process_can_chown_uploads()) {
    return { adjusted: false, uid, gid };
  }

  const normalized_root = path.resolve(local_uploads_root());
  let current = path.resolve(absolute_path);
  if (!is_path_inside_root(current, normalized_root)) {
    return { adjusted: false, uid, gid };
  }

  while (true) {
    await chown(current, uid, gid);
    if (current === normalized_root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current || !is_path_inside_root(parent, normalized_root)) {
      break;
    }
    current = parent;
  }

  return { adjusted: true, uid, gid };
}

function create_local_driver(): ProductImageStorageDriver {
  return {
    async put(storage_key, body) {
      const normalized_target = resolve_local_upload_path(storage_key);
      if (!normalized_target) {
        throw new AppError(
          400,
          "validation_error",
          "Небезопасный путь файла",
        );
      }
      await mkdir(path.dirname(normalized_target), {
        recursive: true,
        mode: UPLOADS_DIR_MODE,
      });
      await writeFile(normalized_target, body, { mode: UPLOADS_FILE_MODE });
      await ensure_local_upload_ownership(normalized_target);
    },
    async delete(storage_key) {
      const normalized_target = resolve_local_upload_path(storage_key);
      if (!normalized_target) {
        return;
      }
      try {
        await unlink(normalized_target);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? (error as { code?: string }).code
            : undefined;
        if (code !== "ENOENT") {
          throw error;
        }
      }
    },
    build_public_url(storage_key) {
      return `/uploads/${storage_key.split(path.sep).join("/")}`;
    },
  };
}

function create_s3_driver(): ProductImageStorageDriver {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const region = process.env.STORAGE_REGION || "auto";
  const bucket = process.env.STORAGE_BUCKET;
  const access_key = process.env.STORAGE_ACCESS_KEY;
  const secret_key = process.env.STORAGE_SECRET_KEY;
  const public_url = (process.env.STORAGE_PUBLIC_URL || "").replace(/\/$/, "");

  if (!endpoint || !bucket || !access_key || !secret_key || !public_url) {
    throw new AppError(
      500,
      "internal_error",
      "Не настроено S3-хранилище изображений",
    );
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: access_key,
      secretAccessKey: secret_key,
    },
    forcePathStyle: true,
  });

  return {
    async put(storage_key, body, content_type) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storage_key,
          Body: body,
          ContentType: content_type,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async delete(storage_key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: storage_key,
        }),
      );
    },
    build_public_url(storage_key) {
      return `${public_url}/${storage_key}`;
    },
  };
}

function create_memory_driver(): ProductImageStorageDriver {
  return {
    async put(storage_key, body) {
      memory_store.set(storage_key, body);
    },
    async delete(storage_key) {
      memory_store.delete(storage_key);
    },
    build_public_url(storage_key) {
      return `/uploads/${storage_key}`;
    },
  };
}

export function get_product_image_storage(): ProductImageStorageDriver {
  if (driver_override) {
    return driver_override;
  }
  const name = get_driver_name();
  if (name === "s3") return create_s3_driver();
  if (name === "memory") return create_memory_driver();
  return create_local_driver();
}

/** Test helper: inject mock/memory storage. Do not use in production. */
export function set_product_image_storage_for_tests(
  driver: ProductImageStorageDriver | null,
) {
  driver_override = driver;
}

export function get_memory_product_image_store(): MemoryStore {
  return memory_store;
}

export function clear_memory_product_image_store() {
  memory_store.clear();
}

function detect_image_kind(
  buffer: Buffer,
): "jpeg" | "png" | "webp" | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function normalize_mime(mime: string | null | undefined): string {
  return (mime || "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function extension_of(filename: string): string {
  const base = path.basename(filename || "");
  const ext = path.extname(base).toLowerCase();
  return ext;
}

export function validate_product_image(input: {
  buffer: Buffer;
  mime_type?: string | null;
  filename?: string | null;
}): { mime_type: string } {
  const { buffer } = input;
  if (!buffer || buffer.length === 0) {
    throw new AppError(
      400,
      "validation_error",
      "Файл повреждён или имеет неподдерживаемый формат",
    );
  }

  if (buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new AppError(
      400,
      "validation_error",
      "Размер файла не должен превышать 5 МБ",
    );
  }

  const mime = normalize_mime(input.mime_type);
  const ext = extension_of(input.filename || "");
  const kind = detect_image_kind(buffer);

  if (mime && !ALLOWED_MIME.has(mime)) {
    throw new AppError(
      400,
      "validation_error",
      "Допустимы только JPG, PNG и WebP",
    );
  }

  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new AppError(
      400,
      "validation_error",
      "Допустимы только JPG, PNG и WebP",
    );
  }

  if (!kind) {
    throw new AppError(
      400,
      "validation_error",
      "Файл повреждён или имеет неподдерживаемый формат",
    );
  }

  if (mime) {
    const mime_kind =
      mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : "webp";
    if (mime_kind !== kind) {
      throw new AppError(
        400,
        "validation_error",
        "Файл повреждён или имеет неподдерживаемый формат",
      );
    }
  }

  if (ext) {
    const ext_ok =
      (kind === "jpeg" && (ext === ".jpg" || ext === ".jpeg")) ||
      (kind === "png" && ext === ".png") ||
      (kind === "webp" && ext === ".webp");
    if (!ext_ok) {
      throw new AppError(
        400,
        "validation_error",
        "Допустимы только JPG, PNG и WebP",
      );
    }
  }

  return {
    mime_type:
      kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : "image/webp",
  };
}

async function process_product_image(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({
        width: PRODUCT_IMAGE_MAX_SIDE,
        height: PRODUCT_IMAGE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new AppError(
      400,
      "validation_error",
      "Файл повреждён или имеет неподдерживаемый формат",
    );
  }
}

function assert_safe_product_id(product_id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      product_id,
    )
  ) {
    throw new AppError(400, "validation_error", "Некорректный идентификатор товара");
  }
}

export function build_product_image_storage_key(product_id: string): string {
  assert_safe_product_id(product_id);
  return `products/${product_id}/${randomUUID()}.webp`;
}

export function build_product_image_url(storage_key: string): string {
  return get_product_image_storage().build_public_url(storage_key);
}

/** Extract managed storage key from a public URL, or null for external/manual URLs. */
export function extract_product_image_storage_key(
  image_url: string | null | undefined,
): string | null {
  if (!image_url) return null;
  const trimmed = image_url.trim();
  if (!trimmed) return null;

  const local_prefix = "/uploads/";
  if (trimmed.startsWith(local_prefix)) {
    const key = trimmed.slice(local_prefix.length);
    return is_managed_product_image_key(key) ? key : null;
  }

  const public_base = (process.env.STORAGE_PUBLIC_URL || "").replace(/\/$/, "");
  if (public_base && trimmed.startsWith(`${public_base}/`)) {
    const key = trimmed.slice(public_base.length + 1);
    return is_managed_product_image_key(key) ? key : null;
  }

  try {
    const url = new URL(trimmed);
    const marker = "/uploads/";
    const idx = url.pathname.indexOf(marker);
    if (idx >= 0) {
      const key = url.pathname.slice(idx + marker.length);
      return is_managed_product_image_key(key) ? key : null;
    }
  } catch {
    // not a URL
  }

  return null;
}

function is_managed_product_image_key(key: string): boolean {
  return /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(key);
}

export async function upload_product_image(input: {
  product_id: string;
  buffer: Buffer;
  mime_type?: string | null;
  filename?: string | null;
}): Promise<StoredProductImage> {
  assert_safe_product_id(input.product_id);
  validate_product_image({
    buffer: input.buffer,
    mime_type: input.mime_type,
    filename: input.filename,
  });

  let processed: Buffer;
  try {
    processed = await process_product_image(input.buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "validation_error",
      "Файл повреждён или имеет неподдерживаемый формат",
    );
  }

  const storage_key = build_product_image_storage_key(input.product_id);
  const storage = get_product_image_storage();

  try {
    await storage.put(storage_key, processed, "image/webp");
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Never log access/secret keys.
    console.error("product image upload failed", {
      product_id: input.product_id,
      storage_key,
      size: processed.length,
      checksum: createHash("sha256").update(processed).digest("hex").slice(0, 12),
    });
    throw new AppError(
      500,
      "internal_error",
      "Не удалось загрузить изображение",
    );
  }

  return {
    storage_key,
    image_url: storage.build_public_url(storage_key),
  };
}

export async function delete_product_image(
  storage_key_or_url: string | null | undefined,
): Promise<void> {
  if (!storage_key_or_url) return;

  const key = is_managed_product_image_key(storage_key_or_url)
    ? storage_key_or_url
    : extract_product_image_storage_key(storage_key_or_url);

  if (!key) return;

  try {
    await get_product_image_storage().delete(key);
  } catch (error) {
    console.error("product image delete failed", { storage_key: key });
    throw error;
  }
}
