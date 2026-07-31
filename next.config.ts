import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers are applied in src/middleware.ts (CSP, nosniff, etc.).
  poweredByHeader: false,
  // Smaller production image for VPS Docker deploys.
  output: "standalone",
  // Serve /uploads via a dynamic route that reads the live filesystem.
  // Standalone Next otherwise caches public/ files at process start, so images
  // written after boot (imports, staff uploads) would 404 until restart.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/uploads/:path*",
          destination: "/api/uploads/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
