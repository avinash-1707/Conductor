import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
import { type ResearchFindings } from "@conductor/shared";

// Mock env so failure branches are deterministic and no real OpenRouter call or
// webhook delivery is ever attempted.
vi.mock("../env", () => ({
  env: {
    OPENROUTER_API_KEY: undefined,
    RESEARCH_MODEL: "anthropic/claude-sonnet-4.5",
    WRITING_MODEL: "anthropic/claude-opus-4.8",
    PUBLISH_WEBHOOK_URL: undefined,
  },
}));

const FINDINGS: ResearchFindings = {
  summary: "Summary.",
  sources: [{ title: "S", url: "https://example.com/s", takeaway: "t" }],
  keyPoints: ["point"],
};

const DRAFT = { title: "Title", markdown: "# Title\n\nBody.", wordCount: 3 };

describe("writeDraft activity", () => {
  it("throws non-retryably on invalid input", async () => {
    const { writeDraft } = await import("./content-pipeline");
    try {
      await writeDraft({
        topic: "",
        keywords: [],
        tone: "technical",
        wordCount: 0,
        findings: FINDINGS,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe("InvalidWriteInput");
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });

  it("throws non-retryably when the OpenRouter key is absent", async () => {
    const { writeDraft } = await import("./content-pipeline");
    try {
      await writeDraft({
        topic: "Topic",
        keywords: ["k"],
        tone: "technical",
        wordCount: 800,
        findings: FINDINGS,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe("MissingOpenRouterKey");
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });
});

describe("publish activity idempotency", () => {
  beforeEach(async () => {
    const { _resetPublishState } = await import("./content-pipeline");
    _resetPublishState();
  });

  it("delivers exactly once per idempotency key", async () => {
    const { publish } = await import("./content-pipeline");

    const first = await publish({ draft: DRAFT, idempotencyKey: "run-1" });
    const second = await publish({ draft: DRAFT, idempotencyKey: "run-1" });

    // Same key returns the same stored receipt — no re-delivery.
    expect(second).toBe(first);
    expect(first.deliveredAt).toBeTypeOf("string");
  });

  it("treats a different key as a distinct delivery", async () => {
    const { publish } = await import("./content-pipeline");

    const a = await publish({ draft: DRAFT, idempotencyKey: "run-1" });
    const b = await publish({ draft: DRAFT, idempotencyKey: "run-2" });

    expect(b).not.toBe(a);
  });
});
