import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @conductor/shared exports TypeScript source (no dist build); Next must
  // transpile it like first-party code (code-standards "Modules").
  transpilePackages: ["@conductor/shared"],
  // The dev-tools badge renders nondeterministically and bleeds into the
  // Playwright snapshot baseline (flaky 0.01-ratio diffs in its corner).
  devIndicators: false,
};

export default nextConfig;
