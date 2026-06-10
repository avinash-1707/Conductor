"use client";

import { AUTH_BASE, SESSION_TOKEN_KEY } from "./config";

/**
 * The short-lived (15m) API JWT used as the bearer for every apps/server route.
 * Distinct from the Better Auth session token: this one is JWKS-signed and
 * carries the active org id (verified statelessly server-side). Cached in
 * memory; refetched from `/api/auth/token` on demand or when forced after a 401.
 */
let cached: { token: string; fetchedAt: number } | null = null;

// Refresh a little before the 15m expiry to avoid races on the boundary.
const SOFT_TTL_MS = 12 * 60 * 1000;

function sessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearApiJwt() {
  cached = null;
}

export async function getApiJwt(force = false): Promise<string | null> {
  if (!force && cached && Date.now() - cached.fetchedAt < SOFT_TTL_MS) {
    return cached.token;
  }
  const session = sessionToken();
  if (!session) return null;

  const res = await fetch(`${AUTH_BASE}/token`, {
    headers: { authorization: `Bearer ${session}` },
  });
  if (!res.ok) {
    cached = null;
    return null;
  }
  const data: unknown = await res.json();
  const token =
    data && typeof data === "object" && typeof (data as { token?: unknown }).token === "string"
      ? (data as { token: string }).token
      : null;
  if (!token) {
    cached = null;
    return null;
  }
  cached = { token, fetchedAt: Date.now() };
  return token;
}
