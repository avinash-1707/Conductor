"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Logo } from "./icons";
import { StatusDot, statusText, type RunStatus } from "./primitives";

type StepStatus = "pending" | "running" | "suspended" | "completed" | "retrying";

const STEPS = ["research", "review", "write", "publish"] as const;

type Frame = {
  dwell: number; // tenths of a second this frame stays on screen
  run: { label: string; status: RunStatus };
  steps: StepStatus[];
  notes: (string | undefined)[];
  stream?: string;
};

// A calm, self-advancing run: research, a human gate, a brief recovery while
// writing, then publish. It tells the product story without anyone clicking.
const FRAMES: Frame[] = [
  {
    dwell: 24,
    run: { label: "running", status: "running" },
    steps: ["running", "pending", "pending", "pending"],
    notes: ["Gathering sources", undefined, undefined, undefined],
  },
  {
    dwell: 30,
    run: { label: "waiting for review", status: "suspended" },
    steps: ["completed", "suspended", "pending", "pending"],
    notes: ["18 sources", "Needs your sign off", undefined, undefined],
  },
  {
    dwell: 26,
    run: { label: "running", status: "running" },
    steps: ["completed", "completed", "running", "pending"],
    notes: ["18 sources", "Approved by Mara", "Drafting", undefined],
    stream: "Writing section 2 of 5",
  },
  {
    dwell: 16,
    run: { label: "recovering", status: "retrying" },
    steps: ["completed", "completed", "retrying", "pending"],
    notes: ["18 sources", "Approved by Mara", "Picking up where it stopped", undefined],
    stream: "Connection restored. Resuming the draft",
  },
  {
    dwell: 18,
    run: { label: "running", status: "running" },
    steps: ["completed", "completed", "completed", "running"],
    notes: ["18 sources", "Approved by Mara", "1,240 words", "Delivering"],
  },
  {
    dwell: 38,
    run: { label: "completed", status: "completed" },
    steps: ["completed", "completed", "completed", "completed"],
    notes: ["18 sources", "Approved by Mara", "1,240 words", "Published"],
  },
];

const TOTAL = FRAMES.reduce((sum, f) => sum + f.dwell, 0);

function frameAt(t: number) {
  let acc = 0;
  for (let i = 0; i < FRAMES.length; i++) {
    acc += FRAMES[i]!.dwell;
    if (t < acc) return i;
  }
  return FRAMES.length - 1;
}

const ROW_TINT: Record<StepStatus, string> = {
  pending: "",
  running: "bg-running/[0.06]",
  suspended: "bg-suspended/[0.07]",
  retrying: "bg-retrying/[0.07]",
  completed: "",
};

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function RunTimeline() {
  const reduced = usePrefersReducedMotion();
  const [t, setT] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setT((p) => (p + 1) % TOTAL), 100);
    return () => window.clearInterval(id);
  }, [reduced]);

  const idx = reduced ? FRAMES.length - 1 : frameAt(t);
  const frame = FRAMES[idx]!;
  const elapsed = reduced ? "6.4" : (t / 10).toFixed(1);
  const done = frame.steps.filter((s) => s === "completed").length;

  return (
    <div className="rounded-xl border border-line-soft bg-surface shadow-[var(--shadow-card)]">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <Logo className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate font-mono text-xs text-faint">
            run_8f2a4c
            <span className="mx-1.5 text-line">/</span>
            <span className="text-muted">blog post pipeline</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-line-soft bg-inset/60 px-2.5 py-1">
          <StatusDot
            status={frame.run.status}
            pulse={frame.run.status === "running" && !reduced}
          />
          <span
            className={`font-mono text-[0.68rem] font-medium ${statusText(
              frame.run.status,
            )}`}
          >
            {frame.run.label}
          </span>
        </div>
      </div>

      {/* rail */}
      <div className="relative px-5 py-5">
        <div className="absolute bottom-9 left-[2.05rem] top-9 w-px bg-line-soft" />
        <ul className="space-y-1">
          {STEPS.map((step, i) => {
            const status = frame.steps[i]!;
            const note = frame.notes[i];
            const active = status === "running" || status === "retrying";
            return (
              <li
                key={step}
                className={`relative flex items-start gap-3.5 rounded-lg px-2 py-2.5 transition-colors duration-500 ${ROW_TINT[status]}`}
              >
                <span className="relative z-10 mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-line-soft bg-surface">
                  {status === "completed" ? (
                    <Check className="h-3 w-3 text-completed" />
                  ) : (
                    <StatusDot
                      status={status === "pending" ? "pending" : status}
                      pulse={status === "running" && !reduced}
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`font-mono text-[0.8rem] ${
                        status === "pending" ? "text-faint" : "text-ink"
                      }`}
                    >
                      {step}
                    </span>
                    {note && (
                      <span
                        className={`truncate text-right text-xs ${
                          active ? statusText(status) : "text-muted"
                        }`}
                      >
                        {note}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* streaming tail */}
        <div className="mt-2 h-12 px-2">
          {frame.stream && (
            <div
              key={`${idx}-${frame.stream}`}
              className="rise flex items-center gap-2 rounded-md border border-line-soft bg-inset px-3 py-2"
            >
              <span className="font-mono text-[0.7rem] text-faint">out</span>
              <span className="caret truncate font-mono text-xs text-muted">
                {frame.stream}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between border-t border-line-soft px-5 py-3 font-mono text-[0.68rem] text-faint">
        <span>
          {done}/{STEPS.length} steps
          <span className="mx-1.5 text-line">·</span>
          1 approval
          <span className="mx-1.5 text-line">·</span>
          <span className="text-completed">0 lost</span>
        </span>
        <span aria-hidden>{elapsed}s</span>
      </div>
    </div>
  );
}
