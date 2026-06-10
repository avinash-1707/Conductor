import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for the server's Postgres schema. Migration #1 (Unit 09)
 * carries the Better Auth + organization tables — tenancy exists from the first
 * migration. `DATABASE_URL` defaults to the docker-compose database.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://conductor:conductor@localhost:5432/conductor",
  },
});
