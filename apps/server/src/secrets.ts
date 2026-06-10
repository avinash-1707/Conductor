import { decryptSecret, encryptSecret, parseEncryptionKey } from "@conductor/shared/crypto";
import { env } from "./env";

/**
 * Server-side binding of the AES-256-GCM helpers to the platform encryption key.
 * The key is parsed once at module load (fail fast on a bad key). Used by the
 * org API-key routes to encrypt on write; the worker binds the same shared
 * helpers to its own env key to decrypt at call time (Unit 12). The plaintext
 * key is never logged, returned, or placed in a Temporal payload (invariant 12).
 */
const key = parseEncryptionKey(env.PLATFORM_ENCRYPTION_KEY);

export function encryptApiKey(plaintext: string): string {
  return encryptSecret(plaintext, key);
}

export function decryptApiKey(token: string): string {
  return decryptSecret(token, key);
}
