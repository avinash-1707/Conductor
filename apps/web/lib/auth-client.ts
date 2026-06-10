"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { AUTH_BASE, SESSION_TOKEN_KEY } from "./config";

function readSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSessionToken(token: string) {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* storage unavailable; session lasts the tab */
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Browser auth client. Auth is bearer-token, not cookies (cross-origin
 * localhost cookies are not viable). The session token arrives in the
 * `set-auth-token` response header on sign-in/up; we persist it and send it as
 * `Authorization: Bearer <sessionToken>` on every `/api/auth/*` call. The
 * separate short-lived API JWT used against apps/server routes is handled in
 * lib/jwt.ts.
 */
export const authClient = createAuthClient({
  baseURL: AUTH_BASE,
  plugins: [organizationClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => readSessionToken(),
    },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) writeSessionToken(token);
    },
  },
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  organization,
} = authClient;
