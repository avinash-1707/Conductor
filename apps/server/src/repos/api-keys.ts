// Bound `org_api_keys` repo (implementation in @conductor/db — the worker
// reads the ciphertext through the same helper and decrypts at call time).
import { createApiKeysRepo } from "@conductor/db";
import { db } from "../db/client";

export type { OrgApiKey } from "@conductor/db";

export const { upsertOrgApiKey, findOrgApiKey } = createApiKeysRepo(db);
