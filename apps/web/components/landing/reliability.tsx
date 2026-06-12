"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Power, Restart } from "./icons";
import { ActionButton, Folio, GhostNumeral } from "./primitives";
import { Reveal } from "./reveal";

type DemoStatus = "idle" | "running" | "down" | "done";

interface LogLine {
  t: string;
  text: string;
  tone: string;
}

const STEPS = [
  { key: "research", ms: 3000 },
  { key: "write", ms: 5200 },
  { key: "publish", ms: 2000 },
];

const WORKERS = ["7f3a", "9c1e", "2b8d", "5e6f", "a014"];
const TICK = 140;

/**
 * §03 — the kill-the-worker demo as an interactive toy. A small pipeline
 * runs; the visitor terminates its worker; another worker picks the run up
 * at the exact position and finishes. The core sales asset, self-served.
 */
export function Reliability() {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState<number[]>([0, 0, 0]);
  const [attempts, setAttempts] = useState<number[]>([1, 1, 1]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [killed, setKilled] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(0);
  const workerIdxRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);

  const log = (text: string, tone = "text-muted") => {
    const t = ((Date.now() - startedAtRef.current) / 1000).toFixed(1);
    setLogs((prev) => [...prev.slice(-8), { t: `t+${t.padStart(4, "0")}s`, text, tone }]);
  };

  const start = () => {
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = [];
    startedAtRef.current = Date.now();
    workerIdxRef.current = 0;
    setStepIdx(0);
    setProgress([0, 0, 0]);
    setAttempts([1, 1, 1]);
    setLogs([]);
    setKilled(false);
    setStatus("running");
    window.setTimeout(() => {
      log(`worker-${WORKERS[0]} picked up the run`, "text-accent");
    }, 0);
  };

  // Auto-start the first run when the section scrolls into view.
  const startedRef = useRef(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The engine: advance the current step's progress while running.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      setProgress((prev) => {
        const next = [...prev];
        const current = Math.min(1, (next[stepIdx] ?? 0) + TICK / (STEPS[stepIdx]?.ms ?? 1000));
        next[stepIdx] = current;
        return next;
      });
    }, TICK);
    return () => window.clearInterval(id);
  }, [status, stepIdx]);

  // Step completion / run completion. Deferred a tick so the bar lands on
  // 100% before the status flips (and to keep the effect body side-effect
  // free for the compiler lint).
  useEffect(() => {
    if (status !== "running") return;
    if ((progress[stepIdx] ?? 0) < 1) return;
    const step = STEPS[stepIdx];
    if (!step) return;
    const id = window.setTimeout(() => {
      log(`${step.key} ✓`, "text-completed");
      if (stepIdx === STEPS.length - 1) {
        setStatus("done");
        log(
          killed
            ? `run completed · attempt ${attempts[stepIdx]} on the record`
            : "run completed. now run it again, and kill it this time",
          "text-completed",
        );
      } else {
        setStepIdx((i) => i + 1);
      }
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, status, stepIdx]);

  const kill = () => {
    if (status !== "running") return;
    const step = STEPS[stepIdx];
    if (!step) return;
    const deadWorker = WORKERS[workerIdxRef.current % WORKERS.length];
    workerIdxRef.current += 1;
    const newWorker = WORKERS[workerIdxRef.current % WORKERS.length];
    const pct = Math.round((progress[stepIdx] ?? 0) * 100);

    setStatus("down");
    setKilled(true);
    log(`⚠ worker-${deadWorker} terminated. that was you`, "text-failed");
    log("run state preserved · nothing lost", "text-muted");

    timeoutsRef.current.push(
      window.setTimeout(() => {
        log(`worker-${newWorker} picked up the run`, "text-accent");
      }, 1100),
      window.setTimeout(() => {
        log(`${step.key} resumed at ${pct}% · exact position, no rework`, "text-running");
        setAttempts((prev) => {
          const next = [...prev];
          next[stepIdx] = (next[stepIdx] ?? 1) + 1;
          return next;
        });
        setStatus("running");
      }, 1900),
    );
  };

  useEffect(() => {
    const pending = timeoutsRef.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const stepTone = (i: number): string => {
    if (i < stepIdx || ((progress[i] ?? 0) >= 1 && status !== "idle")) return "text-completed";
    if (i === stepIdx && status === "down") return "text-retrying";
    if (i === stepIdx && status === "running") return "text-running";
    return "text-pending";
  };

  return (
    <section id="reliability" className="relative scroll-mt-24 py-28 md:py-36">
      <div aria-hidden className="dot-grid absolute inset-0" />
      <div className="relative mx-auto max-w-6xl px-6">
        <GhostNumeral className="right-2 top-0 text-[clamp(7rem,18vw,14rem)]">
          03
        </GhostNumeral>
        <Reveal>
          <Folio n="03" title="Try to break it" />
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-10 max-w-3xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            Our favorite demo is the one where{" "}
            <em className="italic text-accent">you</em> kill it.
          </h2>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted">
            Conductor runs on durable execution. When a worker dies mid-step,
            the run is not lost: another worker picks it up at the exact
            position and finishes the job, and the retry lands in the audit
            trail. Don&apos;t take our word for it:
          </p>
        </Reveal>

        <Reveal delay={200}>
          <div
            ref={rootRef}
            className="relative mt-12 grid gap-px overflow-hidden rounded-xl border border-line-soft bg-[var(--border-subtle)] shadow-[var(--shadow-card)] lg:grid-cols-[1fr_1.1fr]"
          >
            <span
              aria-hidden
              className={`absolute inset-x-0 top-0 z-10 h-px transition-colors duration-300 ${
                status === "down"
                  ? "bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--status-failed)_70%,transparent),transparent)]"
                  : "bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-primary)_45%,transparent),transparent)]"
              }`}
            />
            {/* Steps + the button */}
            <div className="flex flex-col justify-between gap-10 bg-surface p-6">
              <ul className="space-y-6">
                {STEPS.map((step, i) => (
                  <li key={step.key}>
                    <div className="flex items-baseline justify-between font-mono text-xs">
                      <span className={i <= stepIdx && status !== "idle" ? "text-ink" : "text-faint"}>
                        {step.key}
                      </span>
                      <span className={`tabular-nums ${stepTone(i)}`}>
                        {(attempts[i] ?? 1) > 1 ? `attempt ${attempts[i]} · ` : ""}
                        {Math.round((progress[i] ?? 0) * 100)}%
                      </span>
                    </div>
                    <div className={`demo-bar mt-2 h-1 rounded-md bg-inset ${stepTone(i)}`}>
                      <i style={{ "--p": progress[i] ?? 0 } as CSSProperties} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-4">
                {status === "done" ? (
                  <ActionButton variant="ghost" onClick={start}>
                    <Restart className="h-4 w-4" />
                    Run it again
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="danger"
                    onClick={kill}
                    disabled={status !== "running"}
                  >
                    <Power className="h-4 w-4" />
                    Kill the worker
                  </ActionButton>
                )}
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-faint">
                  {status === "done" ? "and again. it keeps working." : "yes, really. click it."}
                </span>
              </div>
            </div>

            {/* Log console */}
            <div className="bg-inset p-6">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
                fig. 03 · worker log
              </p>
              <div className="mt-4 min-h-[13rem] font-mono text-xs leading-6">
                {logs.length === 0 && (
                  <p className="text-faint">scheduling run…</p>
                )}
                {logs.map((line, i) => (
                  <p key={`${line.t}-${i}`} className="rise flex gap-3">
                    <span className="shrink-0 tabular-nums text-faint">{line.t}</span>
                    <span className={line.tone}>{line.text}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-faint">
            <span>
              <span className="text-completed">0</span> runs lost
            </span>
            <span>resumes from the exact step</span>
            <span>every attempt on the record</span>
            <span>failed runs restart from the last good step · tokens spent once</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
