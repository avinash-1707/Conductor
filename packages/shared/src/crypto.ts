import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Symmetric secret encryption for per-org API keys (architecture invariant 12).
 *
 * Pure helper, shared so the server (encrypt on write, Unit 11) and the worker
 * (decrypt at call time, Unit 12) use one implementation without app-to-app
 * imports. The 32-byte key is passed in by the caller — each app reads its own
 * `PLATFORM_ENCRYPTION_KEY` env and parses it; this module reads no env itself.
 *
 * NOT re-exported from the package barrel (`index.ts`) so `apps/web` — which only
 * imports the barrel — never pulls `node:crypto` into the client bundle. Import
 * it explicitly from `@conductor/shared/crypto`.
 *
 * Token format: `v1.<ivB64url>.<tagB64url>.<dataB64url>` (AES-256-GCM, 12-byte
 * IV, 16-byte auth tag). The version prefix keeps future rotation safe.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Decode a base64 platform key and assert it is exactly 32 bytes. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PLATFORM_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt plaintext with AES-256-GCM, returning a self-describing token. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/** Decrypt a token produced by {@link encryptSecret}; throws on tamper/bad key. */
export function decryptSecret(token: string, key: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed or unsupported ciphertext token");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const data = Buffer.from(parts[3]!, "base64url");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
