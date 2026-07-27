#!/usr/bin/env node
/**
 * Verifies clean DB deploy path: migrate deploy + seed idempotency.
 * Usage: node scripts/verify-clean-deploy.mjs
 * Requires DATABASE_URL and SESSION_SECRET.
 */
import { spawnSync } from "child_process";

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL обязателен");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET обязателен");
  process.exit(1);
}

console.log("→ prisma generate");
run("npx", ["prisma", "generate"]);

console.log("→ prisma migrate deploy");
run("npx", ["prisma", "migrate", "deploy"]);

console.log("→ seed #1");
run("npm", ["run", "db:seed"], {
  ...process.env,
  SEED_PASSWORD: process.env.SEED_PASSWORD || "ChangeMe123!",
});

console.log("→ seed #2 (idempotent)");
run("npm", ["run", "db:seed"], {
  ...process.env,
  SEED_PASSWORD: process.env.SEED_PASSWORD || "ChangeMe123!",
});

console.log("Clean deploy verification OK");
