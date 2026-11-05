import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.UMPRA_E2E === "1" ? ".next-e2e" : ".next",
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
