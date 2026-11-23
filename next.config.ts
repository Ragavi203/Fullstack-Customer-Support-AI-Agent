import path from "path";
import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
