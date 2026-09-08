import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { encryptSecret, parseEncryptionKey } from "@conductor/shared/crypto";
import type { Run } from "@conductor/db";
import { type ResearchFindings } from "@conductor/shared";

/**
 * Activity unit tests — plain functions with mocked dependencies (db repos and
 * the agent modules); no network, no Postgres. The dev-default platform key is
 * used so org-key ciphertexts round-trip through the real crypto helper.
 */

const DEV_PLATFORM_KEY = "ZGV2LW9ubHktaW5zZWN1cmUtcGxhdGZvcm0ta2V5ISE=";

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://unused",
    PLATFORM_ENCRYPTION_KEY: "ZGV2LW9ubHktaW5zZWN1cmUtcGxhdGZvcm0ta2V5ISE=",
    RESEARCH_MODEL: "anthropic/claude-sonnet-4.5",
    WRITING_MODEL: "anthropic/claude-opus-4.8",
    PUBLISH_WEBHOOK_URL: undefined,
    LLM_MODE: "live",
  },
}));

vi.mock("../db", () => ({
  repos: {
    runs: {
      findRunByTemporalId: vi.fn(),
      markRunStatus: vi.fn(),
    },
    activityLog: {
      startStepAttempt: vi.fn(),
      recordLlmObservation: vi.fn(),
      completeStep: vi.fn(),
      failStepAttempt: vi.fn(),
    },
    apiKeys: {
      findOrgApiKey: vi.fn(),
    },
    publishDeliveries: {
      findDelivery: vi.fn(),
      recordDelivery: vi.fn(),
    },
  },
}));

// Org model resolution (Unit 33) has its own test file; here it is a seam the
// activities consume — defaulted to the platform models in beforeEach.
vi.mock("./org-models", () => ({
  resolveOrgModels: vi.fn(),
}));

vi.mock("./agents/research", () => ({
  createOpenRouterResearchLLM: vi.fn(() => ({ kind: "research-llm" })),
  runResearch: vi.fn(),
}));
vi.mock("./agents/writing", () => ({
  createOpenRouterWritingLLM: vi.fn(() => ({ kind: "writing-llm" })),
  runWriting: vi.fn(),
}));

import { repos } from "../db";
import { resolveOrgModels } from "./org-models";
import { createOpenRouterResearchLLM, runResearch } from "./agents/research";
import { createOpenRouterWritingLLM, runWriting } from "./agents/writing";
import {
  research,
  writeDraft,
  publish,
  type ResearchInput,
  type WriteDraftInput,
} from "./content-pipeline";

const FINDINGS: ResearchFindings = {
  summary: "Summary.",
  sources: [{ title: "S", url: "https://example.com/s", takeaway: "t" }],
  keyPoints: ["point"],
};

const DRAFT = { title: "Title", markdown: "# Title\n\nBody.", wordCount: 3 };

const RUN: Run = {
  id: "0c8e7a1e-1111-4222-8333-444455556666",
  orgId: "org-1",
  definitionId: null,
  workflowName: "contentPipeline",
  temporalWorkflowId: "wf-1",
  temporalRunId: "tr-1",
  resumedFromRunId: null,
  status: "running",
  input: {
    topic: "t",
    keywords: ["k"],
    tone: "technical",
    wordCount: 800,
    approverId: "u",
  },
  output: null,
  error: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORG_KEY = "sk-or-v1-test-organization-key-1234";

function orgKeyRow(ciphertext: string) {
  return {
    id: "key-row",
    orgId: "org-1",
    ciphertext,
    last4: ORG_KEY.slice(-4),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

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
  vi.mocked(repos.activityLog.startStepAttempt).mockResolvedValue(
    {} as Awaited<ReturnType<typeof repos.activityLog.startStepAttempt>>,
  );
  vi.mocked(repos.activityLog.recordLlmObservation).mockResolvedValue(undefined);
  vi.mocked(repos.activityLog.completeStep).mockResolvedValue(undefined);
  vi.mocked(repos.activityLog.failStepAttempt).mockResolvedValue(undefined);
  vi.mocked(runResearch).mockResolvedValue(FINDINGS);
  vi.mocked(runWriting).mockResolvedValue(DRAFT);
  vi.mocked(resolveOrgModels).mockResolvedValue({
    researchModel: "anthropic/claude-sonnet-4.5",
    writingModel: "anthropic/claude-opus-4.8",
    researchTier: "fast",
    writingTier: "quality",
  });
});

describe("research activity (org key)", () => {
  it("builds the LLM from the org's decrypted OpenRouter key", async () => {
    const ciphertext = encryptSecret(ORG_KEY, parseEncryptionKey(DEV_PLATFORM_KEY));
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(orgKeyRow(ciphertext));

    const researchArg: ResearchInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
    };
    const result = await activityEnv().run(research, researchArg);

    expect(result).toEqual(FINDINGS);
    expect(repos.apiKeys.findOrgApiKey).toHaveBeenCalledWith({ orgId: "org-1" });
    expect(createOpenRouterResearchLLM).toHaveBeenCalledWith({
      apiKey: ORG_KEY,
      model: "anthropic/claude-sonnet-4.5",
      tier: "fast",
      onDelta: expect.any(Function),
      onObservation: expect.any(Function),
    });
    expect(runResearch).toHaveBeenCalledWith(
      { topic: "Topic", keywords: ["k"], tone: "technical" },
      { kind: "research-llm" },
    );
  });

  it("builds the LLM from the org's chosen model when one is set (Unit 33)", async () => {
    const ciphertext = encryptSecret(ORG_KEY, parseEncryptionKey(DEV_PLATFORM_KEY));
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(orgKeyRow(ciphertext));
    vi.mocked(resolveOrgModels).mockResolvedValue({
      researchModel: "google/gemini-3.5-flash",
      writingModel: "openai/gpt-5.5",
      researchTier: "fast",
      writingTier: "quality",
    });

    const researchArg: ResearchInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
    };
    await activityEnv().run(research, researchArg);

    expect(resolveOrgModels).toHaveBeenCalledWith("org-1");
    expect(createOpenRouterResearchLLM).toHaveBeenCalledWith({
      apiKey: ORG_KEY,
      model: "google/gemini-3.5-flash",
      tier: "fast",
      onDelta: expect.any(Function),
      onObservation: expect.any(Function),
    });
  });

  it("fails non-retryably when the org has no key configured", async () => {
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(undefined);

    const researchArg: ResearchInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
    };
    await expect(activityEnv().run(research, researchArg)).rejects.toMatchObject({
      type: "MissingOrgApiKey",
      nonRetryable: true,
    });
    expect(repos.activityLog.failStepAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true }),
    );
    expect(createOpenRouterResearchLLM).not.toHaveBeenCalled();
  });

  it("fails non-retryably when the stored key cannot be decrypted", async () => {
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(
      orgKeyRow("v1.not.a.token"),
    );

    const researchArg: ResearchInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
    };
    await expect(activityEnv().run(research, researchArg)).rejects.toMatchObject({
      type: "OrgApiKeyDecryptFailed",
      nonRetryable: true,
    });
  });
});

describe("writeDraft activity", () => {
  it("throws non-retryably on invalid input", async () => {
    const invalidArg: WriteDraftInput = {
      orgId: "org-1",
      topic: "",
      keywords: [],
      tone: "technical",
      wordCount: 0,
      findings: FINDINGS,
    };
    await expect(activityEnv().run(writeDraft, invalidArg)).rejects.toMatchObject({
      type: "InvalidActivityInput",
      nonRetryable: true,
    });
    expect(repos.apiKeys.findOrgApiKey).not.toHaveBeenCalled();
  });

  it("runs the writing agent on the org's decrypted key", async () => {
    const ciphertext = encryptSecret(ORG_KEY, parseEncryptionKey(DEV_PLATFORM_KEY));
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(orgKeyRow(ciphertext));

    const writeArg: WriteDraftInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
      wordCount: 800,
      findings: FINDINGS,
    };
    const result = await activityEnv().run(writeDraft, writeArg);

    expect(result).toEqual(DRAFT);
    expect(createOpenRouterWritingLLM).toHaveBeenCalledWith({
      apiKey: ORG_KEY,
      model: "anthropic/claude-opus-4.8",
      tier: "quality",
      onDelta: expect.any(Function),
      onObservation: expect.any(Function),
    });
  });

  it("writes with the org's chosen writing model when one is set (Unit 33)", async () => {
    const ciphertext = encryptSecret(ORG_KEY, parseEncryptionKey(DEV_PLATFORM_KEY));
    vi.mocked(repos.apiKeys.findOrgApiKey).mockResolvedValue(orgKeyRow(ciphertext));
    vi.mocked(resolveOrgModels).mockResolvedValue({
      researchModel: "anthropic/claude-sonnet-4.5",
      writingModel: "openai/gpt-5.5-pro",
      researchTier: "fast",
      writingTier: "quality",
    });

    const writeArg: WriteDraftInput = {
      orgId: "org-1",
      topic: "Topic",
      keywords: ["k"],
      tone: "technical",
      wordCount: 800,
      findings: FINDINGS,
    };
    await activityEnv().run(writeDraft, writeArg);

    expect(createOpenRouterWritingLLM).toHaveBeenCalledWith({
      apiKey: ORG_KEY,
      model: "openai/gpt-5.5-pro",
      tier: "quality",
      onDelta: expect.any(Function),
      onObservation: expect.any(Function),
    });
  });
});

describe("publish activity idempotency (Postgres ledger)", () => {
  it("returns the recorded receipt and writes the ledger on first delivery", async () => {
    vi.mocked(repos.publishDeliveries.findDelivery).mockResolvedValue(undefined);
    vi.mocked(repos.publishDeliveries.recordDelivery).mockImplementation(
      async (args) => ({
        id: "delivery-1",
        orgId: args.orgId,
        idempotencyKey: args.idempotencyKey,
        receipt: args.receipt,
        createdAt: new Date(),
      }),
    );

    const receipt = await activityEnv().run(publish, {
      orgId: "org-1",
      draft: DRAFT,
      idempotencyKey: "run-1",
    });

    expect(repos.publishDeliveries.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", idempotencyKey: "run-1" }),
    );
    expect((receipt as { deliveredAt: string }).deliveredAt).toBeTypeOf("string");
  });

  it("returns the cached receipt without re-delivering on a repeat key", async () => {
    const cached = { deliveredAt: "2026-06-10T12:00:00.000Z" };
    vi.mocked(repos.publishDeliveries.findDelivery).mockResolvedValue({
      id: "delivery-1",
      orgId: "org-1",
      idempotencyKey: "run-1",
      receipt: cached,
      createdAt: new Date(),
    });

    const receipt = await activityEnv().run(publish, {
      orgId: "org-1",
      draft: DRAFT,
      idempotencyKey: "run-1",
    });

    expect(receipt).toEqual(cached);
    expect(repos.publishDeliveries.recordDelivery).not.toHaveBeenCalled();
  });
});
