import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @conductor/shared exports TypeScript source (no dist build); Next must
  // transpile it like first-party code (code-standards "Modules").
  transpilePackages: ["@conductor/shared"],
};

export default nextConfig;
