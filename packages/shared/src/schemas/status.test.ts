import { describe, it, expect } from "vitest";
import { runStatusSchema, stepStatusSchema, stepKindSchema } from "./status";

describe("runStatusSchema", () => {
  it("accepts every defined run status", () => {
    for (const s of [
      "pending",
      "running",
      "suspended",
      "completed",
      "failed",
      "cancelled",
      "rejected",
      "expired",
    ]) {
      expect(runStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown statuses", () => {
    expect(runStatusSchema.safeParse("paused").success).toBe(false);
    expect(runStatusSchema.safeParse("").success).toBe(false);
    expect(runStatusSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("stepStatusSchema", () => {
  it("accepts step statuses including retrying", () => {
    for (const s of ["pending", "running", "completed", "failed", "retrying"]) {
      expect(stepStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects run-only statuses", () => {
    expect(stepStatusSchema.safeParse("suspended").success).toBe(false);
    expect(stepStatusSchema.safeParse("expired").success).toBe(false);
  });
});

describe("stepKindSchema", () => {
  it("accepts the three pipeline steps", () => {
    expect(stepKindSchema.safeParse("research").success).toBe(true);
    expect(stepKindSchema.safeParse("write").success).toBe(true);
    expect(stepKindSchema.safeParse("publish").success).toBe(true);
  });

  it("rejects the approval gate as a step kind", () => {
    expect(stepKindSchema.safeParse("approval").success).toBe(false);
  });
});
