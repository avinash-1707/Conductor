/** Where apps/server lives. Override per environment via NEXT_PUBLIC_SERVER_URL. */
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

/** Better Auth is mounted on the server at /api/auth/*. */
export const AUTH_BASE = `${SERVER_URL}/api/auth`;

/** localStorage key holding the Better Auth session token (bearer plugin). */
export const SESSION_TOKEN_KEY = "conductor.session-token";
