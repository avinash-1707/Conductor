"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Power } from "./icons";
import { StatusDot, statusText, type RunStatus } from "./primitives";

type Phase = "running" | "down" | "recovering" | "done";

type StepView = { label: string; status: RunStatus; note: string };

function steps(phase: Phase): StepView[] {
  const write: Record<Phase, StepView> = {
    running: { label: "write", status: "running", note: "Drafting your post" },
    down: { label: "write", status: "failed", note: "It went down at 0:07" },
    recovering: { label: "write", status: "retrying", note: "Back up. Resuming" },
    done: { label: "write", status: "completed", note: "1,240 words" },
  };
  return [
    { label: "research", status: "completed", note: "18 sources" },
    write[phase],
    {
      label: "publish",
      status: phase === "done" ? "completed" : "pending",
      note: phase === "done" ? "Published" : "Waiting",
    },
  ];
}

const RUN_PILL: Record<Phase, { label: string; status: RunStatus }> = {
  running: { label: "running", status: "running" },
  down: { label: "interrupted", status: "failed" },
  recovering: { label: "recovering", status: "retrying" },
  done: { label: "completed", status: "completed" },
};

export function RecoveryDemo() {
  const [phase, setPhase] = useState<Phase>("running");
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function pullThePlug() {
    clearTimers();
    setPhase("down");
    timers.current.push(
      window.setTimeout(() => setPhase("recovering"), 1400),
      window.setTimeout(() => setPhase("done"), 2900),
    );
  }

  function reset() {
    clearTimers();
    setPhase("running");
  }

  const view = steps(phase);
  const pill = RUN_PILL[phase];
  const busy = phase === "down" || phase === "recovering";

  return (
    <div className="rounded-xl border border-line-soft bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
        <span className="font-mono text-xs text-faint">run_recovery_demo</span>
        <div className="flex items-center gap-2 rounded-md border border-line-soft bg-inset/60 px-2.5 py-1">
          <StatusDot
            status={pill.status}
            pulse={pill.status === "running"}
          />
          <span
            className={`font-mono text-[0.68rem] font-medium ${statusText(
              pill.status,
            )}`}
          >
            {pill.label}
          </span>
        </div>
      </div>

      <div className="grid gap-2 px-5 py-6 sm:grid-cols-3">
        {view.map((step, i) => (
          <div key={step.label} className="flex items-center gap-3">
            <div className="min-w-0 flex-1 rounded-lg border border-line-soft bg-inset/50 px-3.5 py-3 transition-colors duration-500">
              <div className="flex items-center gap-2">
                {step.status === "completed" ? (
                  <span className="grid h-4 w-4 place-items-center">
                    <Check className="h-3.5 w-3.5 text-completed" />
                  </span>
                ) : (
                  <StatusDot
                    status={step.status === "pending" ? "pending" : step.status}
                    pulse={step.status === "running"}
                  />
                )}
                <span className="font-mono text-sm text-ink">{step.label}</span>
              </div>
              <p
                className={`mt-1.5 truncate text-xs ${
                  step.status === "pending" ? "text-faint" : statusText(step.status)
                }`}
              >
                {step.note}
              </p>
            </div>
            {i < view.length - 1 && (
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-faint sm:block" />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3 border-t border-line-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs text-muted">
          {phase === "done"
            ? "Recovered. The draft finished without redoing a thing."
            : phase === "running"
              ? "A live run. Try interrupting it."
              : "Coming back on its own. No work lost."}
        </p>
        {phase === "done" ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface/50 px-4 text-sm font-medium text-ink transition-colors duration-200 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Run it again
          </button>
        ) : (
          <button
            type="button"
            onClick={pullThePlug}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-failed/15 px-4 text-sm font-medium text-failed transition-[background-color,transform] duration-200 hover:bg-failed/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-failed focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <Power className="h-4 w-4" />
            {busy ? "Recovering" : "Pull the plug"}
          </button>
        )}
      </div>
    </div>
  );
}
