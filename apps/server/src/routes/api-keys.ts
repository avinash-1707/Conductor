import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { encryptApiKey } from "../secrets";
import { repos } from "../repos/index";

/**
 * Org OpenRouter API-key management (architecture invariant 12). The key is
 * encrypted at rest and the plaintext is never returned, logged, or echoed —
 * only `last4` (for masked "key ending in …AB12" display) ever leaves the
 * server. The org id comes from the verified JWT claim, never the body
 * (invariant 11).
 *
 * - `PUT  /orgs/api-key` — owner-only: set or replace the key.
 * - `GET  /orgs/api-key` — any member: whether a key is configured + its hint.
 */
const setKeyBodySchema = z.object({ apiKey: z.string().min(20) });

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  app.put(
    "/orgs/api-key",
    { preHandler: (req, reply) => app.requireOwner(req, reply) },
    async (req) => {
      const parsed = setKeyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("A valid OpenRouter API key is required");
      }
      const orgId = activeOrgId(req);

      const { apiKey } = parsed.data;
      const last4 = apiKey.slice(-4);
      await repos.apiKeys.upsertOrgApiKey({
        orgId,
        ciphertext: encryptApiKey(apiKey),
        last4,
      });
      return { ok: true, last4 };
    },
  );

  app.get(
    "/orgs/api-key",
    { preHandler: (req, reply) => app.requireSession(req, reply) },
    async (req) => {
      const orgId = activeOrgId(req);
      const row = await repos.apiKeys.findOrgApiKey({ orgId });
      return { configured: Boolean(row), last4: row?.last4 ?? null };
    },
  );
};
