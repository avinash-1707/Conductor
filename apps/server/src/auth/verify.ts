import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { UnauthorizedError } from "../errors";
import type { Auth } from "./auth";

/**
 * Claims resolved from a verified bearer JWT. `activeOrganizationId` is the org
 * the session is scoped to (set when the user selects/creates an org); it is the
 * only org id any handler may trust (architecture invariant 11 — never from the
 * request body).
 */
export interface SessionClaims {
  userId: string;
  email: string | null;
  activeOrganizationId: string | null;
}

export type VerifyToken = (token: string) => Promise<SessionClaims>;

function mapClaims(payload: Record<string, unknown>): SessionClaims {
  const userId = (payload.id ?? payload.sub) as string | undefined;
  if (!userId) {
    throw new UnauthorizedError("Token missing subject");
  }
  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : null,
    activeOrganizationId:
      typeof payload.activeOrganizationId === "string"
        ? payload.activeOrganizationId
        : null,
  };
}

/**
 * Stateless JWT verifier. Builds a *local* JWKS from `auth.api.getJwks()` (the
 * same keys served at `/api/auth/jwks`) and caches it — no per-request DB hit
 * and no HTTP hop. On a verification failure the keys are refreshed once to
 * tolerate key rotation, then the token is rejected.
 */
export function createSessionVerifier(auth: Auth): VerifyToken {
  let jwks: ReturnType<typeof createLocalJWKSet> | undefined;

  async function keySet(force = false): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (!jwks || force) {
      const set = (await auth.api.getJwks()) as JSONWebKeySet;
      jwks = createLocalJWKSet(set);
    }
    return jwks;
  }

  return async function verify(token) {
    try {
      const { payload } = await jwtVerify(token, await keySet());
      return mapClaims(payload);
    } catch {
      try {
        const { payload } = await jwtVerify(token, await keySet(true));
        return mapClaims(payload);
      } catch {
        throw new UnauthorizedError("Invalid or expired token");
      }
    }
  };
}
