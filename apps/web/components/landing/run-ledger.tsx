"use client";

import type { CSSProperties } from "react";
import {
  formatElapsed,
  reached,
  runStatus,
  stepStatus,
  useDemoRun,
  useNow,
  useSequence,
  RESEARCH_MS,
} from "./run-provider";
import type { DemoStep } from "./run-provider";
import { StatusBadge, StatusDot } from "./primitives";
import type { RunStatus } from "./primitives";

const STEPS: { key: DemoStep; label: string }[] = [
  { key: "research", label: "research" },
  { key: "approval", label: "approval gate" },
  { key: "write", label: "write" },
  { key: "publish", label: "publish" },
];

const FLASH: Record<RunStatus, string> = {
  pending: "transparent",
  running: "var(--status-running)",
  suspended: "var(--status-suspended)",
  completed: "var(--status-completed)",
  failed: "var(--status-failed)",
  retrying: "var(--status-retrying)",
  cancelled: "var(--status-cancelled)",
};

const RESEARCH_LINES = [
  "research › crawling 14 sources",
  "research › intent: commercial · buyers comparing",
  "research › gap: nobody prices dispatch automation",
  "research › 6 quotes extracted ✓",
];

/**
 * The hero artifact: a live ledger of the page's demo run. It starts on its
 * own, suspends at the approval gate, and waits for the visitor — the rest
 * of the page is the same run, told in full.
 */
export function RunLedger() {
  const run = useDemoRun();
  const { phase } = run;
  const active = run.startedAt !== null && run.finishedAt === null;
  const now = useNow(active);

  const ends: Record<DemoStep, [number | null, number | null]> = {
    research: [run.startedAt, run.suspendedAt],
    approval: [run.suspendedAt, run.decidedAt],
    write: [run.decidedAt, run.publishingAt],
    publish: [run.publishingAt, run.finishedAt],
  };

  const researchLineCount = useSequence(
    RESEARCH_LINES.length,
    reached(phase, "research"),
    RESEARCH_MS - 600,
  );

  const totalMs =
    run.startedAt === null
      ? 0
      : (run.finishedAt ?? now) - run.startedAt;

  return (
    <figure className="w-full">
      <div className="rounded-xl border border-line-soft bg-surface shadow-[var(--shadow-card)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <span className="truncate font-mono text-xs text-faint">
            run <span className="text-muted">01HFX2…R7TK</span> · blog-post-pipeline
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-faint">
              {formatElapsed(totalMs)}
            </span>
            <StatusBadge
              status={runStatus(phase)}
              label={phase === "rejected" ? "rejected" : undefined}
            />
          </div>
        </div>

        {/* Step rows */}
        <ul className="px-2 py-2">
          {STEPS.map((step) => {
            const status = stepStatus(phase, step.key);
            const [start, end] = ends[step.key];
            const duration =
              start === null
                ? "·"
                : formatElapsed((end ?? now) - start);
            return (
              <li
                key={`${step.key}-${status}`}
                className="status-flash flex items-center gap-3 rounded-md px-2 py-2"
                style={{ "--flash": FLASH[status] } as CSSProperties}
              >
                <StatusDot status={status} pulse={status === "running"} />
                <span
                  className={`font-mono text-xs ${
                    status === "pending" ? "text-faint" : "text-ink"
                  }`}
                >
                  {step.label}
                </span>
                <span aria-hidden className="h-px flex-1 bg-line-soft" />
                <span className="font-mono text-xs tabular-nums text-faint">
                  {duration}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Live line */}
        <div className="min-h-[3.25rem] border-t border-line-soft px-4 py-3 font-mono text-xs leading-5">
          {phase === "boot" && <span className="text-faint">scheduling run…</span>}
          {phase === "research" && (
            <span className="caret text-muted">
              {RESEARCH_LINES[Math.max(0, Math.min(researchLineCount, RESEARCH_LINES.length) - 1)]}
            </span>
          )}
          {phase === "suspended" && (
            <span className="text-suspended">
              paused. a human has to sign off. that&apos;s you.{" "}
              <a
                href="#gate"
                className="link-underline text-accent hover:text-accent-hi"
              >
                go approve ↓
              </a>
            </span>
          )}
          {(phase === "writing" || phase === "publishing") && (
            <span className="caret text-running">
              resumed · draft streaming live below ↓
            </span>
          )}
          {phase === "completed" && (
            <span className="text-completed">
              ✓ completed · every attempt, input and decision on the record ↓
            </span>
          )}
          {phase === "rejected" && (
            <span className="text-cancelled">
              rejected. run ended gracefully. nothing half-published.
            </span>
          )}
        </div>
      </div>
      <figcaption className="mt-3 px-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
        fig. 01 · a live run. it is really waiting for you.
      </figcaption>
    </figure>
  );
}
