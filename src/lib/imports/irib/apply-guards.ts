import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";

export type ApplyGuardResult =
  | { ok: true; backup_size: number; backup_sha256: string }
  | { ok: false; error: string };

export function validate_backup_file(backup_path: string): ApplyGuardResult {
  if (!existsSync(backup_path)) {
    return { ok: false, error: `backup file not found: ${backup_path}` };
  }
  const buf = readFileSync(backup_path);
  if (!buf.length) {
    return { ok: false, error: `backup file is empty: ${backup_path}` };
  }
  const head = buf.subarray(0, Math.min(64, buf.length)).toString("utf8");
  const looks_sql =
    head.includes("PostgreSQL") ||
    head.includes("pg_dump") ||
    head.includes("CREATE TABLE") ||
    head.includes("--") ||
    buf[0] === 0x50 ||
    buf[0] === 0x1f;
  if (!looks_sql && buf.length < 1024) {
    return {
      ok: false,
      error: `backup file looks too small/unreadable as DB dump (${buf.length} bytes)`,
    };
  }
  return {
    ok: true,
    backup_size: buf.length,
    backup_sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export function assert_apply_flags(args: {
  confirmed: boolean;
  backup_path?: string;
  manifest_path?: string;
  merge: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!args.confirmed) {
    return {
      ok: false,
      error: "APPLY BLOCKED: pass --i-understand-and-have-backup after creating a DB backup.",
    };
  }
  if (!args.backup_path) {
    return { ok: false, error: "APPLY BLOCKED: pass --backup-path /path/to/dump" };
  }
  if (!args.manifest_path) {
    return {
      ok: false,
      error: "APPLY BLOCKED: pass --manifest <path to approved-import-manifest.json>",
    };
  }
  if (args.merge) {
    return { ok: false, error: "APPLY BLOCKED: --merge is not allowed for IRIB import" };
  }
  return { ok: true };
}

/** Create-only: never edit an existing product row. */
export function should_skip_existing(existing: { sku: string } | null | undefined): boolean {
  return Boolean(existing?.sku);
}
