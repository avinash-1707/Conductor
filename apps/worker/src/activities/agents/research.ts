import { z } from "zod";
import { generateObject, streamObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ModelTier } from "@conductor/shared";
import {
  researchFindingsSchema,
  type BlogTone,
  type ResearchFindings,
} from "@conductor/shared";
import { runLlmCall, type LlmCallConfig } from "./llm-call";

/**
 * Research agent — a LangGraph sub-graph (gather → synthesize → validate) that
 * the `research` activity invokes. The graph owns reasoning only; the activity
 * owns timeouts, error classification, and result shaping (code-standards
 * Temporal). Model calls go through the Vercel AI SDK over OpenRouter — the
 * model layer is injected via {@link ResearchLLM} so the graph is tested
 * deterministically without a network.
 */

/** Input the activity hands the graph. */
export interface ResearchInput {
  topic: string;
  keywords: string[];
  tone: BlogTone;
}

// --- Step schemas (worker-internal; the cross-boundary output is the shared
// researchFindingsSchema). Used both as AI SDK structured-output schemas and as
// the ResearchLLM contract. ---

const gatherSchema = z.object({
  sources: researchFindingsSchema.shape.sources,
  notes: z.string().min(1),
});
export type GatherResult = z.infer<typeof gatherSchema>;

const synthSchema = z.object({
  summary: researchFindingsSchema.shape.summary,
  keyPoints: researchFindingsSchema.shape.keyPoints,
});
export type SynthesizeResult = z.infer<typeof synthSchema>;

/**
 * The model layer the graph depends on. The real implementation calls
 * OpenRouter; tests pass a deterministic fake.
 */
export interface ResearchLLM {
  gatherSources(input: ResearchInput): Promise<GatherResult>;
  synthesize(
    input: ResearchInput & { sources: GatherResult["sources"]; notes: string },
  ): Promise<SynthesizeResult>;
}

/** Each LLM call is bounded well under the activity's 2-minute timeout. */
const LLM_CALL_TIMEOUT_MS = 60_000;

export const RESEARCH_PROMPT_VERSIONS = {
  gather: "research.gather@v1",
  synthesize: "research.synthesize@v1",
} as const;

/**
 * OpenRouter-backed {@link ResearchLLM}. Built per-activity-invocation from the
 * key + model the activity resolves (env in Phase 1; the org's decrypted key in
 * Phase 2). `maxRetries: 1` keeps coarse retry with Temporal. When `onDelta` is
 * provided (Unit 20), the synthesized summary is streamed token-by-token via
 * `streamObject` — only the final validated object is returned (it becomes the
 * activity result, i.e. the Temporal payload); the deltas ride Redis only.
 */
export function createOpenRouterResearchLLM(config: {
  apiKey: string;
  model: string;
  tier: ModelTier;
  onDelta?: (delta: string) => void;
  onObservation?: LlmCallConfig["onObservation"];
}): ResearchLLM {
  const openrouter = createOpenRouter({ apiKey: config.apiKey });
  const model = openrouter.chat(config.model);

  return {
    async gatherSources(input) {
      const system =
        "You are a meticulous research assistant for a content team. " +
        "Propose credible source angles for a content piece and capture synthesis notes. " +
        "Each source needs a title, a plausible URL, and a one-sentence takeaway.";
      const prompt =
        `Topic: ${input.topic}\n` +
        `Target keywords: ${input.keywords.join(", ")}\n` +
        `Intended tone: ${input.tone}\n\n` +
        "Identify 3-6 distinct, credible source angles a writer should ground this piece in, " +
        "then write concise synthesis notes tying them to the topic.";
      return runLlmCall(
        { ...config, operation: "research.gather", promptVersion: RESEARCH_PROMPT_VERSIONS.gather },
        (repairInstruction) =>
          generateObject({
            model,
            schema: gatherSchema,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
            system: repairInstruction ? `${system}\n\n${repairInstruction}` : system,
            prompt,
          }),
      );
    },

    async synthesize(input) {
      const sourcesBlock = input.sources
        .map((s, i) => `${i + 1}. ${s.title} — ${s.takeaway} (${s.url})`)
        .join("\n");
      const system =
        "You are a research analyst. Synthesize gathered sources into a tight summary " +
        "and a list of key points a writer can build a draft from.";
      const prompt =
        `Topic: ${input.topic}\n` +
        `Target keywords: ${input.keywords.join(", ")}\n` +
        `Intended tone: ${input.tone}\n\n` +
        `Sources:\n${sourcesBlock}\n\n` +
        `Notes:\n${input.notes}\n\n` +
        "Write a 2-4 sentence summary and 3-7 key points grounded in the sources above.";
      const abortSignal = AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);

      return runLlmCall(
        { ...config, operation: "research.synthesize", promptVersion: RESEARCH_PROMPT_VERSIONS.synthesize },
        async (repairInstruction) => {
          const repairedSystem = repairInstruction ? `${system}\n\n${repairInstruction}` : system;
          if (!config.onDelta || repairInstruction) {
            return generateObject({
              model,
              schema: synthSchema,
              maxRetries: 0,
              abortSignal,
              system: repairedSystem,
              prompt,
            });
          }
          const result = streamObject({ model, schema: synthSchema, maxRetries: 0, abortSignal, system, prompt });
          let emitted = 0;
          for await (const partial of result.partialObjectStream) {
            const text = partial.summary ?? "";
            if (text.length > emitted) {
              config.onDelta(text.slice(emitted));
              emitted = text.length;
            }
          }
          return {
            object: await result.object,
            usage: await result.usage,
            providerMetadata: await result.providerMetadata,
          };
        },
      );
    },
  };
}

/** Graph state — channels flow gather → synthesize → validate. */
const ResearchState = Annotation.Root({
  topic: Annotation<string>(),
  keywords: Annotation<string[]>(),
  tone: Annotation<BlogTone>(),
  sources: Annotation<GatherResult["sources"]>(),
  notes: Annotation<string>(),
  summary: Annotation<string>(),
  keyPoints: Annotation<string[]>(),
  findings: Annotation<ResearchFindings>(),
});

/**
 * Builds the compiled research graph over an injected model layer. Sequential
 * edges; `validate` parses the assembled output against the shared schema so an
 * unusable model response fails here rather than downstream.
 */
export function buildResearchGraph(llm: ResearchLLM) {
  return new StateGraph(ResearchState)
    .addNode("gather", async (state) => {
      const { sources, notes } = await llm.gatherSources({
        topic: state.topic,
        keywords: state.keywords,
        tone: state.tone,
      });
      return { sources, notes };
    })
    .addNode("synthesize", async (state) => {
      const { summary, keyPoints } = await llm.synthesize({
        topic: state.topic,
        keywords: state.keywords,
        tone: state.tone,
        sources: state.sources,
        notes: state.notes,
      });
      return { summary, keyPoints };
    })
    .addNode("validate", (state) => {
      const findings = researchFindingsSchema.parse({
        summary: state.summary,
        sources: state.sources,
        keyPoints: state.keyPoints,
      });
      return { findings };
    })
    .addEdge(START, "gather")
    .addEdge("gather", "synthesize")
    .addEdge("synthesize", "validate")
    .addEdge("validate", END)
    .compile();
}

/** Runs the graph end-to-end and returns the validated findings. */
export async function runResearch(
  input: ResearchInput,
  llm: ResearchLLM,
): Promise<ResearchFindings> {
  const graph = buildResearchGraph(llm);
  const final = await graph.invoke({
    topic: input.topic,
    keywords: input.keywords,
    tone: input.tone,
  });
  return researchFindingsSchema.parse(final.findings);
}
