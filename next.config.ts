import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers are applied in src/middleware.ts (CSP, nosniff, etc.).
  poweredByHeader: false,
  // Smaller production image for VPS Docker deploys.
  output: "standalone",
};

export default nextConfig;
