"use client";

import type { CSSProperties } from "react";
import { Check, Restart, X } from "./icons";
import {
  ActionButton,
  Folio,
  StatusBadge,
  StatusDot,
} from "./primitives";
import type { RunStatus } from "./primitives";
import { Reveal } from "./reveal";
import {
  formatElapsed,
  reached,
  stepStatus,
  useDemoRun,
  useNow,
  useStream,
  RESEARCH_MS,
  WRITE_MS,
} from "./run-provider";
import type { DemoStep } from "./run-provider";

const RESEARCH_TEXT = `topic     "what a missed appointment costs an hvac company"
sources   14 crawled · 6 quotes pulled
intent    commercial — buyers comparing field-service platforms
gap       nobody prices out dispatch automation honestly
angle     lead with the $380-per-missed-visit math, then the fix`;

const DRAFT_TEXT = `# What a Missed Appointment Really Costs an HVAC Company

Every dispatcher knows the moment: the tech is forty minutes out,
the customer has called twice, and the schedule board looks like a
losing game of Tetris. The visit gets rebooked. Nobody writes down
what it cost.

Run the math, though, and a missed appointment stops being a
scheduling problem. It becomes a $380 line item that never appears
on any invoice…`;

const RAIL: { key: DemoStep; label: string }[] = [
  { key: "research", label: "research" },
  { key: "approval", label: "approval gate" },
  { key: "write", label: "write" },
  { key: "publish", label: "publish" },
];

const STATUS_WORD: Record<RunStatus, string> = {
  pending: "pending",
  running: "running",
  suspended: "waiting",
  completed: "done",
  failed: "failed",
  retrying: "retrying",
  cancelled: "ended",
};

function statusTone(status: RunStatus) {
  return {
    pending: "text-faint",
    running: "text-running",
    suspended: "text-suspended",
    completed: "text-completed",
    failed: "text-failed",
    retrying: "text-retrying",
    cancelled: "text-cancelled",
  }[status];
}

function StepHeading({
  n,
  title,
  status,
  label,
}: {
  n: string;
  title: string;
  status: RunStatus;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-xs text-faint">step {n}</span>
      <h3 className="font-display text-2xl tracking-tight">{title}</h3>
      <StatusBadge status={status} label={label} className="ml-auto" />
    </div>
  );
}

function Console({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line-soft bg-inset px-5 py-4 font-mono text-xs leading-6 ${className}`}
    >
      {children}
    </div>
  );
}

/** §02 — the hero's run, told step by step, with a real approval gate. */
export function RunStory() {
  const run = useDemoRun();
  const { phase } = run;
  const now = useNow(phase === "suspended");

  const research = useStream(
    RESEARCH_TEXT,
    reached(phase, "research"),
    RESEARCH_MS - 700,
  );
  const draft = useStream(DRAFT_TEXT, reached(phase, "writing"), WRITE_MS - 600);

  const waitedMs =
    run.suspendedAt === null
      ? 0
      : (run.decidedAt ?? now) - run.suspendedAt;

  const durations: Record<DemoStep, string> = {
    research:
      run.suspendedAt && run.startedAt
        ? formatElapsed(run.suspendedAt - run.startedAt)
        : "—",
    approval: run.suspendedAt ? formatElapsed(waitedMs) : "—",
    write:
      run.publishingAt && run.decidedAt
        ? formatElapsed(run.publishingAt - run.decidedAt)
        : "—",
    publish:
      run.finishedAt && run.publishingAt
        ? formatElapsed(run.finishedAt - run.publishingAt)
        : "—",
  };

  return (
    <section id="run" className="scroll-mt-24 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <Folio n="02" title="One run, start to finish" />
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-10 max-w-3xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            The ledger above isn&apos;t an animation. It&apos;s{" "}
            <em className="italic text-accent">this run</em>.
          </h2>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted">
            Four steps, one human gate, nobody watching. Here is the same run,
            told in full — and it will not move past the gate until you decide.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-12 lg:grid-cols-[220px_1fr] lg:gap-16">
          {/* Timeline rail — the product's signature element. */}
          <div className="hidden lg:block">
            <div className="sticky top-28">
              <ol className="relative ml-1 border-l border-line">
                {RAIL.map((item) => {
                  const status = stepStatus(phase, item.key);
                  return (
                    <li key={item.key} className="relative pb-10 pl-6 last:pb-0">
                      <span className="absolute -left-[4.5px] top-1.5">
                        <StatusDot
                          status={status}
                          pulse={status === "running"}
                        />
                      </span>
                      <p
                        className={`font-mono text-xs ${
                          status === "pending" ? "text-faint" : "text-ink"
                        }`}
                      >
                        {item.label}
                      </p>
                      <p
                        className={`mt-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] ${statusTone(status)}`}
                      >
                        {STATUS_WORD[status]}
                      </p>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
                fig. 02 — the timeline rail
              </p>
            </div>
          </div>

          {/* Step artifacts */}
          <div className="space-y-20">
            {/* 1 — research */}
            <Reveal>
              <StepHeading
                n="1"
                title="Research streams"
                status={stepStatus(phase, "research")}
              />
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                Each step is a specialist agent doing one job. Research crawls
                sources, pulls quotes, finds the angle — and streams its work
                live, so nobody wonders what is happening inside.
              </p>
              <Console className="mt-6 min-h-[9.5rem] whitespace-pre-wrap text-muted">
                {research.started ? (
                  <span className={research.done ? "" : "caret"}>
                    {research.text}
                  </span>
                ) : (
                  <span className="text-faint">waiting for worker…</span>
                )}
              </Console>
            </Reveal>

            {/* 2 — approval gate */}
            <Reveal>
              <div id="gate" className="scroll-mt-28">
                <StepHeading
                  n="2"
                  title="A human signs off"
                  status={stepStatus(phase, "approval")}
                  label={
                    phase === "suspended" ? "waiting on you" : undefined
                  }
                />
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                  Then the run stops. On purpose. Before a model speaks for
                  your client, a person signs off. The run suspends — no
                  compute burned, no polling — until someone decides. It would
                  wait 24 hours, then expire politely. Today it waits for you.
                </p>

                <div
                  className={`mt-6 rounded-lg border border-line-soft bg-surface shadow-[var(--shadow-card)] transition-opacity duration-300 ${
                    reached(phase, "suspended") ? "" : "opacity-50"
                  }`}
                  style={{
                    borderLeft:
                      phase === "suspended"
                        ? "3px solid var(--status-suspended)"
                        : phase === "rejected"
                          ? "3px solid var(--status-cancelled)"
                          : reached(phase, "writing")
                            ? "3px solid var(--status-completed)"
                            : undefined,
                  }}
                >
                  <div className="border-b border-line-soft px-5 py-3">
                    <p className="font-mono text-xs text-faint">
                      approval requested ·{" "}
                      <span className="text-muted">blog-post-pipeline</span> ·
                      step <span className="text-muted">write</span>
                    </p>
                  </div>
                  <div className="px-5 py-4">
                    <div className="rounded-md bg-inset px-4 py-3 font-mono text-xs leading-6 text-muted">
                      <p className="text-ink">research summary</p>
                      <p>
                        angle — lead with the $380-per-missed-visit math, then
                        the fix
                      </p>
                      <p>14 sources · 6 quotes · intent: commercial</p>
                      <p className="text-completed">recommend: proceed to draft</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-4">
                    {phase === "suspended" && (
                      <>
                        <ActionButton size="sm" onClick={run.approve}>
                          <Check className="h-4 w-4" />
                          Approve
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="danger"
                          onClick={run.reject}
                        >
                          <X className="h-4 w-4" />
                          Reject
                        </ActionButton>
                        <span className="ml-auto font-mono text-xs tabular-nums text-suspended">
                          waiting {formatElapsed(waitedMs)}
                        </span>
                      </>
                    )}
                    {!reached(phase, "suspended") && (
                      <span className="font-mono text-xs text-faint">
                        the gate arms when research completes
                      </span>
                    )}
                    {reached(phase, "writing") && phase !== "rejected" && (
                      <span className="font-mono text-xs text-completed">
                        ✓ approved · you · after {durations.approval} · on the
                        record
                      </span>
                    )}
                    {phase === "rejected" && (
                      <>
                        <span className="font-mono text-xs text-cancelled">
                          ✗ rejected · you · run ended gracefully — nothing
                          half-published
                        </span>
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          onClick={run.reset}
                          className="ml-auto"
                        >
                          <Restart className="h-4 w-4" />
                          Run it again
                        </ActionButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>

            {/* 3 — write */}
            <Reveal>
              <StepHeading
                n="3"
                title="The run resumes"
                status={stepStatus(phase, "write")}
              />
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                A decision resumes the run in under two seconds. The writer
                takes the approved angle and streams the draft as it is
                written.
              </p>
              <Console className="mt-6 min-h-[13rem] whitespace-pre-wrap text-muted">
                {phase === "rejected" ? (
                  <span className="text-faint">
                    run ended at the gate — nothing was written.
                  </span>
                ) : draft.started ? (
                  <span className={draft.done ? "" : "caret"}>{draft.text}</span>
                ) : (
                  <span className="text-faint">
                    ⏸ waiting at the gate — approve above to resume
                  </span>
                )}
              </Console>
            </Reveal>

            {/* 4 — publish + audit */}
            <Reveal>
              <StepHeading
                n="4"
                title="Closed, on the record"
                status={stepStatus(phase, "publish")}
              />
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                Publish delivers the output, and the run closes over a complete
                audit trail — every input, output, attempt and decision, with
                names and timestamps. Replayable forever.
              </p>
              <Console className="mt-6">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-faint">
                      <th className="pb-2 font-normal">step</th>
                      <th className="pb-2 font-normal">attempts</th>
                      <th className="pb-2 font-normal">duration</th>
                      <th className="pb-2 font-normal">note</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    <AuditRow
                      done={reached(phase, "suspended")}
                      step="research"
                      attempts="1"
                      duration={durations.research}
                      note="14 sources"
                    />
                    <AuditRow
                      done={reached(phase, "writing") || phase === "rejected"}
                      step="approval"
                      attempts="—"
                      duration={durations.approval}
                      note={
                        phase === "rejected" ? "rejected · you" : "approved · you"
                      }
                      noteTone={
                        phase === "rejected" ? "text-cancelled" : "text-completed"
                      }
                    />
                    <AuditRow
                      done={reached(phase, "publishing")}
                      step="write"
                      attempts="1"
                      duration={durations.write}
                      note="1,180 words"
                    />
                    <AuditRow
                      done={phase === "completed"}
                      step="publish"
                      attempts="1"
                      duration={durations.publish}
                      note="webhook · 201"
                    />
                  </tbody>
                </table>
                <p
                  className={`mt-3 border-t border-line-soft pt-3 ${
                    phase === "completed" ? "text-completed" : "text-faint"
                  }`}
                >
                  {phase === "completed"
                    ? "run 01HFX2…R7TK · completed · replayable"
                    : "run 01HFX2…R7TK · in progress"}
                </p>
              </Console>
            </Reveal>

            <Reveal>
              <p className="max-w-xl text-lg leading-relaxed text-muted">
                Now imagine ten of these at once, none of them watched.{" "}
                <span className="text-ink">That&apos;s the product.</span>
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditRow({
  done,
  step,
  attempts,
  duration,
  note,
  noteTone = "",
}: {
  done: boolean;
  step: string;
  attempts: string;
  duration: string;
  note: string;
  noteTone?: string;
}) {
  const dim: CSSProperties | undefined = done ? undefined : { opacity: 0.35 };
  return (
    <tr style={dim} className="transition-opacity duration-300">
      <td className="py-1 pr-4 text-ink">{step}</td>
      <td className="py-1 pr-4 tabular-nums">{done ? attempts : "—"}</td>
      <td className="py-1 pr-4 tabular-nums">{done ? duration : "—"}</td>
      <td className={`py-1 ${done ? noteTone : ""}`}>{done ? note : "—"}</td>
    </tr>
  );
}
