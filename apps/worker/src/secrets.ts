import { decryptSecret, parseEncryptionKey } from "@conductor/shared/crypto";
import { env } from "./env";

/**
 * Worker-side binding of the AES-256-GCM helpers to the platform encryption
 * key (the same shared implementation the server encrypts with — Unit 11).
 * The key is parsed once at module load (fail fast on a bad key). Decryption
 * happens only inside activities at call time; the plaintext is never logged,
 * returned in errors, or placed in a Temporal payload (invariant 12).
 */
const key = parseEncryptionKey(env.PLATFORM_ENCRYPTION_KEY);

export function decryptApiKey(token: string): string {
  return decryptSecret(token, key);
}
