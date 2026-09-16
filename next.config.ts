import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained .next/standalone output for a small production Docker
  // image (only traced node_modules included, not the full tree).
  output: "standalone",
};

export default nextConfig;
