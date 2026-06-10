import { Pool } from "pg";
import { createDb } from "@conductor/db";
import { env } from "../env";

/**
 * Drizzle client over the server's dedicated pg pool, built from the shared
 * `@conductor/db` factory (the schema and repos live there so the worker can
 * reuse them — Unit 12). Better Auth (Unit 09) and the bound repositories
 * (repos/) share this `db`. The readiness pool in `deps.ts` is separate by
 * design (health checks must not contend with app queries).
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = createDb(pool);
export type Db = typeof db;
