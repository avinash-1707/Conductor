import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import type { Approval, Run } from "@conductor/db";
import type { ApprovalContext } from "@conductor/shared";

vi.mock("../db", () => ({
  repos: {
    runs: {
      findRunByTemporalId: vi.fn(),
      markRunStatus: vi.fn(),
      markRunTerminal: vi.fn(),
    },
    activityLog: {
      failStepAttempt: vi.fn(),
    },
    approvals: {
      upsertApprovalForRun: vi.fn(),
      closePendingForRun: vi.fn(),
    },
  },
}));

import { repos } from "../db";
import { createApprovalRequest, type CreateApprovalRequestInput } from "./approvals";
import { recordRunTerminal, type RecordRunTerminalInput } from "./projections";

const CONTEXT: ApprovalContext = {
  research: {
    summary: "Findings summary.",
    sources: [{ title: "Src", url: "https://example.com", takeaway: "Useful." }],
    keyPoints: ["Point one"],
  },
};

const RUN = {
  id: "0c8e7a1e-1111-4222-8333-444455556666",
  orgId: "org-1",
  temporalWorkflowId: "wf-1",
} as Run;

const APPROVAL = {
  id: "2c8e7a1e-1111-4222-8333-444455556666",
  orgId: "org-1",
  runId: RUN.id,
  status: "pending",
} as Approval;

const input: CreateApprovalRequestInput = {
  orgId: "org-1",
  approverId: "user_approver",
  context: CONTEXT,
};

function activityEnv(): MockActivityEnvironment {
  return new MockActivityEnvironment({
    attempt: 1,
    workflowExecution: { workflowId: "wf-1", runId: "tr-1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repos.runs.findRunByTemporalId).mockResolvedValue(RUN);
  vi.mocked(repos.runs.markRunStatus).mockResolvedValue(RUN);
  vi.mocked(repos.approvals.upsertApprovalForRun).mockResolvedValue(APPROVAL);
});

describe("createApprovalRequest", () => {
  it("writes the gate record with the context and suspends the run", async () => {
    const result = await activityEnv().run(createApprovalRequest, input);

    expect(result).toEqual({ approvalId: APPROVAL.id });
    expect(repos.approvals.upsertApprovalForRun).toHaveBeenCalledWith({
      orgId: "org-1",
      runId: RUN.id,
      context: CONTEXT,
    });
    expect(repos.runs.markRunStatus).toHaveBeenCalledWith({
      orgId: "org-1",
      temporalWorkflowId: "wf-1",
      status: "suspended",
    });
  });

  it("is idempotent — a retry returns the existing approval id", async () => {
    await activityEnv().run(createApprovalRequest, input);
    const second = await activityEnv().run(createApprovalRequest, input);
    // The repo upsert is insert-or-return-existing; both calls yield one id.
    expect(second).toEqual({ approvalId: APPROVAL.id });
  });

  it("rejects invalid input non-retryably", async () => {
    await expect(
      activityEnv().run(createApprovalRequest, { ...input, orgId: "" }),
    ).rejects.toMatchObject({ type: "InvalidActivityInput", nonRetryable: true });
    expect(repos.approvals.upsertApprovalForRun).not.toHaveBeenCalled();
  });

  it("throws retryably when the run projection row is missing", async () => {
    vi.mocked(repos.runs.findRunByTemporalId).mockResolvedValue(undefined);
    await expect(activityEnv().run(createApprovalRequest, input)).rejects.toThrow(
      /projection row missing/,
    );
  });
});

describe("recordRunTerminal gate cleanup", () => {
  beforeEach(() => {
    vi.mocked(repos.runs.markRunTerminal).mockResolvedValue(RUN);
  });

  it("closes a still-pending approval on expiry and rejection", async () => {
    const expired: RecordRunTerminalInput = { orgId: "org-1", status: "expired" };
    await activityEnv().run(recordRunTerminal, expired);
    expect(repos.approvals.closePendingForRun).toHaveBeenCalledWith({
      orgId: "org-1",
      runId: RUN.id,
      status: "expired",
    });

    const rejected: RecordRunTerminalInput = { orgId: "org-1", status: "rejected" };
    await activityEnv().run(recordRunTerminal, rejected);
    expect(repos.approvals.closePendingForRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
  });

  it("leaves approvals alone for completed and failed runs", async () => {
    const failed: RecordRunTerminalInput = { orgId: "org-1", status: "failed" };
    const completed: RecordRunTerminalInput = {
      orgId: "org-1",
      status: "completed",
      output: {
        draft: { title: "T", markdown: "# T", wordCount: 3 },
        deliveredAt: "2026-06-10T12:00:00.000Z",
      },
    };
    await activityEnv().run(recordRunTerminal, failed);
    await activityEnv().run(recordRunTerminal, completed);
    expect(repos.approvals.closePendingForRun).not.toHaveBeenCalled();
  });
});
