import { z } from "zod";
import { generateObject, streamObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  blogDraftSchema,
  type BlogDraft,
  type BlogTone,
  type ResearchFindings,
} from "@conductor/shared";

/**
 * Writing agent — a LangGraph sub-graph (outline → draft → refine → finalize)
 * that consumes the research findings and produces a `BlogDraft`. Same shape as
 * the research agent (Unit 05): the model layer is injected behind {@link
 * WritingLLM} so the graph is tested without a network; the activity builds the
 * real OpenRouter-backed implementation. `wordCount` is computed deterministically
 * in `finalize`, never trusted from the model.
 */

export interface WritingInput {
  topic: string;
  keywords: string[];
  tone: BlogTone;
  wordCount: number;
  findings: ResearchFindings;
}

const outlineSchema = z.object({
  outline: z.array(z.string().min(1)).min(1),
});
const draftSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
});
type DraftResult = z.infer<typeof draftSchema>;

export interface WritingLLM {
  outline(input: WritingInput): Promise<{ outline: string[] }>;
  draft(input: WritingInput & { outline: string[] }): Promise<DraftResult>;
  refine(input: WritingInput & { draft: DraftResult }): Promise<DraftResult>;
}

/** Drafting/refine calls run longer than research; stay under the activity timeout. */
const LLM_CALL_TIMEOUT_MS = 90_000;

function findingsBlock(findings: ResearchFindings): string {
  const sources = findings.sources
    .map((s, i) => `${i + 1}. ${s.title} — ${s.takeaway} (${s.url})`)
    .join("\n");
  const points = findings.keyPoints.map((p) => `- ${p}`).join("\n");
  return `Summary: ${findings.summary}\n\nKey points:\n${points}\n\nSources:\n${sources}`;
}

/**
 * OpenRouter-backed {@link WritingLLM} (built per activity invocation). When
 * `onDelta` is provided (Unit 20), the draft markdown is streamed
 * token-by-token via `streamObject`; only the final validated object is
 * returned (the activity result → Temporal payload), so token deltas never
 * enter Temporal — they ride Redis only (architecture invariant 8).
 */
export function createOpenRouterWritingLLM(config: {
  apiKey: string;
  model: string;
  onDelta?: (delta: string) => void;
}): WritingLLM {
  const openrouter = createOpenRouter({ apiKey: config.apiKey });
  const model = openrouter.chat(config.model);
  const signal = () => AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);

  return {
    async outline(input) {
      const { object } = await generateObject({
        model,
        schema: outlineSchema,
        maxRetries: 1,
        abortSignal: signal(),
        system:
          "You are a content strategist. Produce a tight section outline for a content piece, " +
          "grounded in the supplied research.",
        prompt:
          `Topic: ${input.topic}\nKeywords: ${input.keywords.join(", ")}\n` +
          `Tone: ${input.tone}\nTarget length: ~${input.wordCount} words\n\n` +
          `Research:\n${findingsBlock(input.findings)}\n\n` +
          "Return an ordered list of section headings/beats for the piece.",
      });
      return object;
    },

    async draft(input) {
      const system =
        "You are a senior content writer. Write the requested content piece in Markdown, " +
        "in the requested tone, grounded in the research. Include a title.";
      const prompt =
        `Topic: ${input.topic}\nKeywords: ${input.keywords.join(", ")}\n` +
        `Tone: ${input.tone}\nTarget length: ~${input.wordCount} words\n\n` +
        `Outline:\n${input.outline.map((s) => `- ${s}`).join("\n")}\n\n` +
        `Research:\n${findingsBlock(input.findings)}\n\n` +
        "Write the full draft now.";

      if (config.onDelta) {
        const result = streamObject({ model, schema: draftSchema, maxRetries: 1, abortSignal: signal(), system, prompt });
        let emitted = 0;
        for await (const partial of result.partialObjectStream) {
          const text = partial.markdown ?? "";
          if (text.length > emitted) {
            config.onDelta(text.slice(emitted));
            emitted = text.length;
          }
        }
        return await result.object;
      }

      const { object } = await generateObject({ model, schema: draftSchema, maxRetries: 1, abortSignal: signal(), system, prompt });
      return object;
    },

    async refine(input) {
      const { object } = await generateObject({
        model,
        schema: draftSchema,
        maxRetries: 1,
        abortSignal: signal(),
        system:
          "You are an editor. Tighten the draft: improve flow and clarity, enforce the tone, " +
          "fix weak transitions, and keep it close to the target length. Return the full revised post.",
        prompt:
          `Tone: ${input.tone}\nTarget length: ~${input.wordCount} words\n\n` +
          `Current title: ${input.draft.title}\n\nCurrent draft:\n${input.draft.markdown}`,
      });
      return object;
    },
  };
}

/** Counts whitespace-delimited words in the draft body. */
function countWords(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}

const WritingState = Annotation.Root({
  topic: Annotation<string>(),
  keywords: Annotation<string[]>(),
  tone: Annotation<BlogTone>(),
  wordCount: Annotation<number>(),
  findings: Annotation<ResearchFindings>(),
  outline: Annotation<string[]>(),
  title: Annotation<string>(),
  markdown: Annotation<string>(),
  draft: Annotation<BlogDraft>(),
});

export function buildWritingGraph(llm: WritingLLM) {
  const baseInput = (state: typeof WritingState.State): WritingInput => ({
    topic: state.topic,
    keywords: state.keywords,
    tone: state.tone,
    wordCount: state.wordCount,
    findings: state.findings,
  });

  // Node names must not collide with state channel names (outline/draft are
  // channels), so the phases are named distinctly.
  return new StateGraph(WritingState)
    .addNode("plan", async (state) => {
      const { outline } = await llm.outline(baseInput(state));
      return { outline };
    })
    .addNode("compose", async (state) => {
      const { title, markdown } = await llm.draft({
        ...baseInput(state),
        outline: state.outline,
      });
      return { title, markdown };
    })
    .addNode("refine", async (state) => {
      const { title, markdown } = await llm.refine({
        ...baseInput(state),
        draft: { title: state.title, markdown: state.markdown },
      });
      return { title, markdown };
    })
    .addNode("finalize", (state) => {
      // Word count is computed, not trusted from the model.
      const draft = blogDraftSchema.parse({
        title: state.title,
        markdown: state.markdown,
        wordCount: countWords(state.markdown),
      });
      return { draft };
    })
    .addEdge(START, "plan")
    .addEdge("plan", "compose")
    .addEdge("compose", "refine")
    .addEdge("refine", "finalize")
    .addEdge("finalize", END)
    .compile();
}

export async function runWriting(input: WritingInput, llm: WritingLLM): Promise<BlogDraft> {
  const graph = buildWritingGraph(llm);
  const final = await graph.invoke({
    topic: input.topic,
    keywords: input.keywords,
    tone: input.tone,
    wordCount: input.wordCount,
    findings: input.findings,
  });
  return blogDraftSchema.parse(final.draft);
}
