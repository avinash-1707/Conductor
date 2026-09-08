import { describe, expect, it, vi } from "vitest";
import { blogDraftSchema, researchFindingsSchema, type ResearchFindings } from "@conductor/shared";
import { runResearch, type ResearchLLM } from "../activities/agents/research";
import { runWriting, type WritingLLM } from "../activities/agents/writing";

const findings: ResearchFindings = {
  summary: "Durable execution recovers a workflow after infrastructure failure.",
  sources: [
    {
      title: "Temporal documentation",
      url: "https://docs.temporal.io/",
      takeaway: "Event history lets workflows resume after worker failures.",
    },
  ],
  keyPoints: ["Workflow state is durable.", "Activities must be idempotent."],
};

describe("content-agent regression eval", () => {
  it("produces validated research and a draft from a representative content request", async () => {
    const researchModel: ResearchLLM = {
      gatherSources: vi.fn(async () => ({
        sources: findings.sources,
        notes: "Use durable execution.",
      })),
      synthesize: vi.fn(async () => ({ summary: findings.summary, keyPoints: findings.keyPoints })),
    };
    const writingModel: WritingLLM = {
      outline: vi.fn(async () => ({ outline: ["Problem", "Approach", "Outcome"] })),
      draft: vi.fn(async () => ({
        title: "Durable AI workflows",
        markdown: "# Durable AI workflows\n\nDurable execution preserves work across failures.",
      })),
      refine: vi.fn(async (input) => input.draft),
    };

    const research = await runResearch(
      { topic: "Durable AI workflows", keywords: ["Temporal"], tone: "technical" },
      researchModel,
    );
    const draft = await runWriting(
      {
        topic: "Durable AI workflows",
        keywords: ["Temporal"],
        tone: "technical",
        wordCount: 500,
        findings: research,
      },
      writingModel,
    );

    expect(researchFindingsSchema.safeParse(research).success).toBe(true);
    expect(blogDraftSchema.safeParse(draft).success).toBe(true);
    expect(researchModel.gatherSources).toHaveBeenCalledOnce();
    expect(researchModel.synthesize).toHaveBeenCalledOnce();
    expect(writingModel.outline).toHaveBeenCalledOnce();
    expect(writingModel.draft).toHaveBeenCalledOnce();
    expect(writingModel.refine).toHaveBeenCalledOnce();
  });
});
