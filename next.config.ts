import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers are applied in src/middleware.ts (CSP, nosniff, etc.).
  poweredByHeader: false,
};

export default nextConfig;
