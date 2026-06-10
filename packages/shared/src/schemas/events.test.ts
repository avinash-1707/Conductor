import { describe, it, expect } from "vitest";
import { runEventSchema, tokenStreamEventSchema } from "./events";

const at = "2026-06-10T12:00:00.000Z";

describe("runEventSchema", () => {
  it("accepts a run.status event", () => {
    expect(
      runEventSchema.safeParse({ type: "run.status", runId: "r1", status: "running", at }).success,
    ).toBe(true);
  });

  it("accepts a step.status event with a positive attempt", () => {
    expect(
      runEventSchema.safeParse({
        type: "step.status",
        runId: "r1",
        step: "research",
        status: "retrying",
        attempt: 2,
        at,
      }).success,
    ).toBe(true);
  });

  it("accepts an approval.requested event", () => {
    expect(
      runEventSchema.safeParse({
        type: "approval.requested",
        runId: "r1",
        approvalId: "a1",
        orgId: "org1",
        at,
      }).success,
    ).toBe(true);
  });

  it("rejects an approval.requested event without its org (org-room fanout)", () => {
    expect(
      runEventSchema.safeParse({
        type: "approval.requested",
        runId: "r1",
        approvalId: "a1",
        at,
      }).success,
    ).toBe(false);
  });

  it("rejects attempt < 1 (boundary)", () => {
    expect(
      runEventSchema.safeParse({
        type: "step.status",
        runId: "r1",
        step: "research",
        status: "running",
        attempt: 0,
        at,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown event type", () => {
    expect(runEventSchema.safeParse({ type: "run.created", runId: "r1", at }).success).toBe(false);
  });

  it("rejects a step.status carrying a run-only status", () => {
    expect(
      runEventSchema.safeParse({
        type: "step.status",
        runId: "r1",
        step: "research",
        status: "suspended",
        attempt: 1,
        at,
      }).success,
    ).toBe(false);
  });
});

describe("tokenStreamEventSchema", () => {
  it("accepts a token chunk (empty delta allowed)", () => {
    expect(
      tokenStreamEventSchema.safeParse({ type: "token", runId: "r1", step: "write", delta: "" })
        .success,
    ).toBe(true);
  });

  it("accepts a done event", () => {
    expect(
      tokenStreamEventSchema.safeParse({ type: "done", runId: "r1", step: "write" }).success,
    ).toBe(true);
  });

  it("rejects a token event missing delta", () => {
    expect(
      tokenStreamEventSchema.safeParse({ type: "token", runId: "r1", step: "write" }).success,
    ).toBe(false);
  });
});
