import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env";
import * as schema from "./schema";

/**
 * Drizzle client over a dedicated pg pool. Better Auth (Unit 09) and the
 * org-scoped repositories (Unit 10) share this `db`. The readiness pool in
 * `deps.ts` is separate by design (health checks must not contend with app
 * queries).
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
export type Db = typeof db;
