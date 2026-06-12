import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @conductor/shared exports TypeScript source (no dist build); Next must
  // transpile it like first-party code (code-standards "Modules").
  transpilePackages: ["@conductor/shared"],
  // Self-contained production server for the Docker image (Unit 28a) — the
  // runner stage copies .next/standalone and runs `node server.js`.
  output: "standalone",
  // The dev-tools badge renders nondeterministically and bleeds into the
  // Playwright snapshot baseline (flaky 0.01-ratio diffs in its corner).
  devIndicators: false,
  // The old auth routes live on as redirects (bookmarks, stale emails).
  // Unmatched query params (e.g. ?next=) pass through automatically.
  async redirects() {
    return [
      { source: "/login", destination: "/auth", permanent: false },
      { source: "/signup", destination: "/auth?mode=signup", permanent: false },
    ];
  },
};

export default nextConfig;
