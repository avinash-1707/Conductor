import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Drizzle client factory over an injected pg Pool. The package reads no env —
 * each app (server, worker) constructs its own pool from its own config and
 * owns its lifecycle (code-standards "Data and Storage": both apps connect
 * with their own pool).
 */
export function createDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;
