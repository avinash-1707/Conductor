import { Pool } from "pg";
import { createDb, createRepos } from "@conductor/db";
import { env } from "./env";

/**
 * The worker's own pg pool + bound org-scoped repositories (the schema and
 * repo implementations are shared with the server via `@conductor/db`;
 * code-standards "Data and Storage"). Activities import `repos` from here —
 * it is the single seam tests mock so activity tests stay network-free.
 * The pool is drained by worker.ts on shutdown.
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db = createDb(pool);
export const repos = createRepos(db);
