import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

/**
 * Production-env hardening (Unit 28a): the baked-in dev secrets exist so local
 * runs need zero config — a production boot on them is a silent security hole,
 * so the parse refuses outright.
 */

const realSecret = "a-real-secret-with-more-than-32-characters";
const realKey = Buffer.alloc(32, 7).toString("base64");

describe("parseEnv production guards", () => {
  it("parses with zero config outside production (dev defaults apply)", () => {
    const env = parseEnv({});
    expect(env.SERVER_PORT).toBe(4000);
    expect(env.BETTER_AUTH_SECRET).toContain("dev-only");
  });

  it("refuses the dev BETTER_AUTH_SECRET in production", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", PLATFORM_ENCRYPTION_KEY: realKey }),
    ).toThrow(/BETTER_AUTH_SECRET is the dev default/);
  });

  it("refuses the dev PLATFORM_ENCRYPTION_KEY in production", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: realSecret }),
    ).toThrow(/PLATFORM_ENCRYPTION_KEY is the dev default/);
  });

  it("refuses KEY_VERIFICATION=off in production (Unit 33)", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: realSecret,
        PLATFORM_ENCRYPTION_KEY: realKey,
        KEY_VERIFICATION: "off",
      }),
    ).toThrow(/KEY_VERIFICATION=off is an E2E\/dev facility/);
  });

  it("boots in production once both secrets are real", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: realSecret,
      PLATFORM_ENCRYPTION_KEY: realKey,
    });
    expect(env.NODE_ENV).toBe("production");
  });
});
