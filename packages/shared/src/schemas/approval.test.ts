import { describe, it, expect } from "vitest";
import {
  approvalContextSchema,
  approvalDecisionSchema,
  approvalListResponseSchema,
  approvalResourceSchema,
  approvalSignalPayloadSchema,
  approvalStatusSchema,
} from "./approval";

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

describe("approvalStatusSchema", () => {
  it("accepts the four lifecycle states", () => {
    for (const s of ["pending", "approved", "rejected", "expired"]) {
      expect(approvalStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(approvalStatusSchema.safeParse("cancelled").success).toBe(false);
  });
});

describe("approvalContextSchema", () => {
  const research = {
    summary: "A summary of findings.",
    sources: [{ title: "Source", url: "https://example.com", takeaway: "Useful." }],
    keyPoints: ["Point one"],
  };

  it("accepts research-only context", () => {
    expect(approvalContextSchema.safeParse({ research }).success).toBe(true);
  });

  it("accepts research with a draft", () => {
    const draft = { title: "Title", markdown: "# Body", wordCount: 2 };
    expect(approvalContextSchema.safeParse({ research, draft }).success).toBe(true);
  });

  it("rejects missing research", () => {
    expect(approvalContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("approvalResourceSchema", () => {
  const research = {
    summary: "A summary of findings.",
    sources: [{ title: "Source", url: "https://example.com", takeaway: "Useful." }],
    keyPoints: ["Point one"],
  };
  const valid = {
    id: "0c8e7a1e-1111-4222-8333-444455556666",
    runId: "1c8e7a1e-1111-4222-8333-444455556666",
    status: "pending",
    context: { research },
    reviewerId: null,
    decidedAt: null,
    createdAt: "2026-06-10T12:00:00.000Z",
  };

  it("accepts a pending request and a decided one", () => {
    expect(approvalResourceSchema.safeParse(valid).success).toBe(true);
    expect(
      approvalResourceSchema.safeParse({
        ...valid,
        status: "approved",
        reviewerId: "user_1",
        decidedAt: "2026-06-10T13:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid run id and a malformed timestamp (boundary)", () => {
    expect(
      approvalResourceSchema.safeParse({ ...valid, runId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      approvalResourceSchema.safeParse({ ...valid, createdAt: "today" }).success,
    ).toBe(false);
  });

  it("never carries an org id in the contract", () => {
    expect("orgId" in approvalResourceSchema.shape).toBe(false);
  });
});

describe("approvalListResponseSchema", () => {
  it("accepts pages with and without a next cursor", () => {
    expect(
      approvalListResponseSchema.safeParse({ items: [], nextCursor: null }).success,
    ).toBe(true);
    expect(
      approvalListResponseSchema.safeParse({ items: [], nextCursor: "" }).success,
    ).toBe(false);
  });
});
