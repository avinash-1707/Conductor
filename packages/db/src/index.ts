// @conductor/db — Drizzle schema, client factory, and org-scoped repositories
// shared by apps/server and apps/worker (code-standards "Data and Storage":
// the worker reuses the same schema definitions via this package; both apps
// connect with their own pool). The package reads no env and owns no pool.

export * from "./schema";
export { createDb, type Db } from "./client";
export * from "./repos";
