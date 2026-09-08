import {
  blogDraftSchema,
  researchFindingsSchema,
  type InterpreterResume,
} from "@conductor/shared";
import type { Step } from "@conductor/db";

/**
 * Derives where a failed run resumes from its stored `activity_log` outputs
 * (Unit 22, channel-based since Unit 26) — pure, so the derivation is
 * unit-testable without Postgres. The resume point is computed server-side
 * only; clients never choose it.
 *
 * The interpreter skips any node whose `produces` channel is supplied here
 * (publish — which produces nothing — always re-runs: it never delivered) and
 * skips the gate only when `gateApproved`. A completed write does not prove
 * the reviewer authorized publish: gate creation or approval may have failed
 * after the draft completed.
 *
 * JSONB outputs are Zod-parsed on read (code-standards Data & Storage): a
 * step whose stored output no longer parses is treated as not completed and
 * the plan falls down the chain — robustness over a crashed resume.
 */
export interface ResumePlan {
  /** Omitted entirely when nothing usable completed (full restart). */
  resume: InterpreterResume | undefined;
  /** Completed prior step rows to copy into the new run's activity_log. */
  carriedSteps: Step[];
}

export function buildResumePlan(steps: Step[], approvalApproved: boolean): ResumePlan {
  const completed = (kind: Step["stepKind"]) =>
    steps.find((s) => s.stepKind === kind && s.status === "completed");

  const researchRow = completed("research");
  const writeRow = completed("write");
  const research = researchRow
    ? researchFindingsSchema.safeParse(researchRow.output)
    : undefined;
  const write = writeRow ? blogDraftSchema.safeParse(writeRow.output) : undefined;

  if (researchRow && research?.success && writeRow && write?.success) {
    return {
      resume: {
        channels: { research: research.data, draft: write.data },
        gateApproved: approvalApproved,
      },
      carriedSteps: [researchRow, writeRow],
    };
  }
  if (researchRow && research?.success) {
    return {
      resume: {
        channels: { research: research.data },
        // The gate is skipped only when the prior run's gate was approved;
        // otherwise the resumed run re-asks with the carried findings.
        gateApproved: approvalApproved,
      },
      carriedSteps: [researchRow],
    };
  }
  return { resume: undefined, carriedSteps: [] };
}
