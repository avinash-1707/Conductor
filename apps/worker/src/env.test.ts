import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

/**
 * Production-env hardening (Unit 28a): refuse the dev encryption key and the
 * canned model mode in production — both are silent correctness/security holes.
 */

const realKey = Buffer.alloc(32, 7).toString("base64");

describe("parseEnv production guards", () => {
  it("parses with zero config outside production (dev defaults apply)", () => {
    const env = parseEnv({});
    expect(env.TEMPORAL_ADDRESS).toBe("localhost:7233");
    expect(env.LLM_MODE).toBe("live");
    expect(env.WORKER_HEALTH_PORT).toBe(4001);
  });

  it("refuses the dev PLATFORM_ENCRYPTION_KEY in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(
      /PLATFORM_ENCRYPTION_KEY is the dev default/,
    );
  });

  it("refuses LLM_MODE=mock in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        PLATFORM_ENCRYPTION_KEY: realKey,
        LLM_MODE: "mock",
      }),
    ).toThrow(/never run it in production/);
  });

  it("boots in production with a real key and the live model", () => {
    const env = parseEnv({ NODE_ENV: "production", PLATFORM_ENCRYPTION_KEY: realKey });
    expect(env.LLM_MODE).toBe("live");
  });
});
