/**
 * Generate TINDA PWA icons (text mark on brand teal).
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "icons");
const BRAND = "#0f766e";
const FG = "#ffffff";

async function render_png(size, { maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.18) : Math.round(size * 0.12);
  const font_size = Math.round(size * (maskable ? 0.22 : 0.28));
  const radius = Math.round(size * (maskable ? 0 : 0.18));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BRAND}"/>
  <text
    x="50%"
    y="50%"
    fill="${FG}"
    font-family="Manrope, Arial, Helvetica, sans-serif"
    font-size="${font_size}"
    font-weight="700"
    letter-spacing="${Math.round(size * 0.02)}"
    text-anchor="middle"
    dominant-baseline="central"
  >ТИНДА</text>
</svg>`;

  // Extra padding ring for maskable (safe zone) — solid brand fill already covers full canvas.
  void pad;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const files = [
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "icon-512-maskable.png", size: 512, maskable: true },
    { name: "apple-touch-icon.png", size: 180 },
  ];

  for (const file of files) {
    const buf = await render_png(file.size, { maskable: Boolean(file.maskable) });
    await fs.writeFile(path.join(OUT, file.name), buf);
    console.log("wrote", file.name, buf.length, "bytes");
  }

  // Favicon 32x32 + 16x16 multi-size ico via png favicon for browsers
  const fav32 = await render_png(32);
  await fs.writeFile(path.join(ROOT, "public", "favicon.png"), fav32);
  // Also drop a small ico-compatible png into app for Next metadata
  await fs.writeFile(path.join(OUT, "favicon-32.png"), fav32);
  console.log("wrote public/favicon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
