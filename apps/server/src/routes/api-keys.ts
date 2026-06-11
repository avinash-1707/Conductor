import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError, ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { verifyOpenRouterKey, type KeyVerification } from "../lib/openrouter";
import { encryptApiKey } from "../secrets";
import { env } from "../env";
import { repos } from "../repos/index";

/**
 * Org OpenRouter API-key management (architecture invariant 12). The key is
 * encrypted at rest and the plaintext is never returned, logged, or echoed —
 * only `last4` (for masked "key ending in …AB12" display) ever leaves the
 * server. The org id comes from the verified JWT claim, never the body
 * (invariant 11).
 *
 * - `PUT  /orgs/api-key` — owner-only: verify the key live against OpenRouter
 *   (Unit 33), then set or replace it. A rejected key stores nothing; an
 *   unreachable OpenRouter fails OPEN (stored with a warning) so an upstream
 *   blip never blocks onboarding — validity is proven on first run regardless.
 * - `GET  /orgs/api-key` — any member: whether a key is configured + its hint.
 */
const setKeyBodySchema = z.object({ apiKey: z.string().min(20) });

export function apiKeyRoutes(deps?: {
  /** Test seam — defaults to the live OpenRouter check (or a no-op when KEY_VERIFICATION=off). */
  verifyKey?: (apiKey: string) => Promise<KeyVerification>;
}): FastifyPluginAsync {
  const verifyKey =
    deps?.verifyKey ??
    (env.KEY_VERIFICATION === "off"
      ? async (): Promise<KeyVerification> => "valid"
      : verifyOpenRouterKey);

  return async (app) => {
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

        const verification = await verifyKey(apiKey);
        if (verification === "invalid") {
          throw new AppError(
            "That OpenRouter key was rejected. Check it and try again.",
            "invalid_api_key",
            400,
          );
        }
        if (verification === "unavailable") {
          // Fail open: never the key itself, only the fact verification was skipped.
          req.log.warn(
            { event: "api_key.verification_unavailable", orgId },
            "OpenRouter unreachable — key stored unverified",
          );
        }

        const last4 = apiKey.slice(-4);
        await repos.apiKeys.upsertOrgApiKey({
          orgId,
          ciphertext: encryptApiKey(apiKey),
          last4,
        });
        // Golden-path instrumentation (Unit 29). Never the key — only the event.
        req.log.info({ event: "golden_path.key_configured", orgId }, "org key configured");
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
}
