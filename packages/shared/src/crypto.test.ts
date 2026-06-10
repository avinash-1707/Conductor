import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./crypto";

const key = randomBytes(32);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips plaintext", () => {
    const secret = "sk-or-v1-abcdef0123456789";
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it("produces ciphertext that is not the plaintext", () => {
    const secret = "sk-or-v1-secret";
    expect(encryptSecret(secret, key)).not.toContain(secret);
  });

  it("uses a fresh IV so two encryptions of the same input differ", () => {
    const secret = "sk-or-v1-secret";
    expect(encryptSecret(secret, key)).not.toBe(encryptSecret(secret, key));
  });

  it("throws when the auth tag is tampered with", () => {
    const token = encryptSecret("sk-or-v1-secret", key);
    const parts = token.split(".");
    const tag = Buffer.from(parts[2]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    parts[2] = tag.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("throws when decrypted with the wrong key", () => {
    const token = encryptSecret("sk-or-v1-secret", key);
    expect(() => decryptSecret(token, randomBytes(32))).toThrow();
  });

  it("throws on a malformed token", () => {
    expect(() => decryptSecret("not-a-token", key)).toThrow();
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow();
  });
});

describe("parseEncryptionKey", () => {
  it("accepts a base64-encoded 32-byte key", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64")).length).toBe(32);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow();
    expect(() => parseEncryptionKey(randomBytes(64).toString("base64"))).toThrow();
  });
});
