import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: { unoptimized: true },
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
