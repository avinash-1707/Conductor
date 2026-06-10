import { z } from "zod";
import { ValidationError } from "../errors";

/**
 * Opaque list cursor for keyset pagination over `(created_at, id)` — the
 * shape every org-scoped list endpoint paginates on (architecture
 * Scalability & Operations). Encoded as base64url JSON; malformed input from
 * a client is a 400, never a 500.
 */
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

const cursorPayloadSchema = z.object({ c: z.iso.datetime(), i: z.uuid() });

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString("base64url");
}

export function decodeKeysetCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid cursor");
  }
  const payload = cursorPayloadSchema.safeParse(parsed);
  if (!payload.success) throw new ValidationError("Invalid cursor");
  return { createdAt: new Date(payload.data.c), id: payload.data.i };
}
