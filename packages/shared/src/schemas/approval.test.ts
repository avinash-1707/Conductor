import { describe, it, expect } from "vitest";
import { approvalDecisionSchema, approvalSignalPayloadSchema } from "./approval";

describe("approvalDecisionSchema", () => {
  it("accepts approved and rejected", () => {
    expect(approvalDecisionSchema.safeParse("approved").success).toBe(true);
    expect(approvalDecisionSchema.safeParse("rejected").success).toBe(true);
  });

  it("rejects anything else", () => {
    expect(approvalDecisionSchema.safeParse("expired").success).toBe(false);
    expect(approvalDecisionSchema.safeParse("APPROVED").success).toBe(false);
  });
});

describe("approvalSignalPayloadSchema", () => {
  const valid = {
    decision: "approved",
    reviewerId: "user_123",
    decidedAt: "2026-06-10T12:00:00.000Z",
  };

  it("accepts a well-formed payload", () => {
    expect(approvalSignalPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty reviewerId (boundary)", () => {
    expect(approvalSignalPayloadSchema.safeParse({ ...valid, reviewerId: "" }).success).toBe(false);
  });

  it("rejects a non-datetime decidedAt", () => {
    expect(
      approvalSignalPayloadSchema.safeParse({ ...valid, decidedAt: "2026-06-10" }).success,
    ).toBe(false);
  });

  it("rejects an invalid decision", () => {
    expect(approvalSignalPayloadSchema.safeParse({ ...valid, decision: "maybe" }).success).toBe(
      false,
    );
  });
});
