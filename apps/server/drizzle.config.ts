import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for the Postgres schema. Migration #1 (Unit 09) carries
 * the Better Auth + organization tables — tenancy exists from the first
 * migration. The schema source moved to `@conductor/db` in Unit 12 (shared
 * with the worker); migrations remain owned and applied here. `DATABASE_URL`
 * defaults to the docker-compose database.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://conductor:conductor@localhost:5432/conductor",
  },
});
