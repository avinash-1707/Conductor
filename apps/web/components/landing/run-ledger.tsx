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
 * own, suspends at the approval gate, and waits for the visitor; the rest
 * of the page is the same run, told in full. Styled as a glass console over
 * the hero's glow: blurred translucent surface, accent top hairline, and a
 * miniature timeline rail through the step dots.
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
    run.startedAt === null ? 0 : (run.finishedAt ?? now) - run.startedAt;

  return (
    <figure className="relative w-full">
      {/* Halo so the panel sits inside the hero's glow instead of on it. */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[2.5rem] bg-[radial-gradient(58%_58%_at_50%_32%,var(--glow-accent),transparent_72%)] blur-2xl"
      />

      <div className="relative overflow-hidden rounded-xl border border-line-soft bg-[color-mix(in_oklab,var(--bg-surface)_78%,transparent)] shadow-[var(--shadow-card)] backdrop-blur-md">
        {/* Accent hairline along the top edge. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-primary)_55%,transparent),transparent)]"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <span className="truncate font-mono text-xs text-faint">
            <span className="text-accent">run</span>{" "}
            <span className="text-muted">01HFX2…R7TK</span> ·
            blog-post-pipeline
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

        {/* Step rows over a miniature timeline rail. */}
        <ul className="relative px-3 py-2">
          <span
            aria-hidden
            className="absolute bottom-7 top-7 left-[1.69rem] w-px bg-line-soft"
          />
          {STEPS.map((step) => {
            const status = stepStatus(phase, step.key);
            const [start, end] = ends[step.key];
            const duration =
              start === null ? "·" : formatElapsed((end ?? now) - start);
            return (
              <li
                key={`${step.key}-${status}`}
                className="status-flash relative flex items-center gap-3 rounded-md px-2 py-2"
                style={{ "--flash": FLASH[status] } as CSSProperties}
              >
                <span className="relative z-10 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-inset ring-1 ring-[color:var(--border-default)]">
                  <StatusDot status={status} pulse={status === "running"} />
                </span>
                <span
                  className={`font-mono text-xs ${
                    status === "pending" ? "text-faint" : "text-ink"
                  }`}
                >
                  {step.label}
                </span>
                <span
                  aria-hidden
                  className="mb-1 flex-1 self-end border-b border-dotted border-[color:var(--border-default)]"
                />
                <span className="font-mono text-xs tabular-nums text-faint">
                  {duration}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Live line */}
        <div className="min-h-[3.25rem] border-t border-line-soft bg-[color-mix(in_oklab,var(--bg-inset)_55%,transparent)] px-4 py-3 font-mono text-xs leading-5">
          {phase === "boot" && (
            <span className="text-faint">scheduling run…</span>
          )}
          {phase === "research" && (
            <span className="caret text-muted">
              {
                RESEARCH_LINES[
                  Math.max(
                    0,
                    Math.min(researchLineCount, RESEARCH_LINES.length) - 1,
                  )
                ]
              }
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

      <figcaption className="mt-3 flex items-baseline justify-between px-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
        <span>fig. 01 · a live run</span>
        <span>it is really waiting for you</span>
      </figcaption>
    </figure>
  );
}
