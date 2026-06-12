"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { RunStatus } from "./primitives";

/**
 * The landing page tells the story of one demo run. This provider is its
 * state machine: research streams on load, the run suspends at the approval
 * gate, and it only resumes when the visitor clicks Approve — the page
 * physically demonstrates the product's core moment.
 */
export type DemoPhase =
  | "boot"
  | "research"
  | "suspended"
  | "writing"
  | "publishing"
  | "completed"
  | "rejected";

export const RESEARCH_MS = 5600;
export const WRITE_MS = 7200;
export const PUBLISH_MS = 1500;

const ORDER: DemoPhase[] = [
  "boot",
  "research",
  "suspended",
  "writing",
  "publishing",
  "completed",
];

/** Has the run reached (or passed) the given phase? */
export function reached(phase: DemoPhase, target: DemoPhase) {
  if (phase === "rejected") {
    return ORDER.indexOf(target) <= ORDER.indexOf("suspended");
  }
  return ORDER.indexOf(phase) >= ORDER.indexOf(target);
}

export type DemoStep = "research" | "approval" | "write" | "publish";

export function stepStatus(phase: DemoPhase, step: DemoStep): RunStatus {
  switch (step) {
    case "research":
      if (phase === "boot") return "pending";
      if (phase === "research") return "running";
      return "completed";
    case "approval":
      if (phase === "rejected") return "cancelled";
      if (phase === "suspended") return "suspended";
      return reached(phase, "writing") ? "completed" : "pending";
    case "write":
      if (phase === "rejected") return "cancelled";
      if (phase === "writing") return "running";
      return reached(phase, "publishing") ? "completed" : "pending";
    case "publish":
      if (phase === "rejected") return "cancelled";
      if (phase === "publishing") return "running";
      return phase === "completed" ? "completed" : "pending";
  }
}

export function runStatus(phase: DemoPhase): RunStatus {
  if (phase === "boot") return "pending";
  if (phase === "suspended") return "suspended";
  if (phase === "completed") return "completed";
  if (phase === "rejected") return "cancelled";
  return "running";
}

export interface DemoRun {
  phase: DemoPhase;
  /** Phase timestamps — durations on the page are real, measured time. */
  startedAt: number | null;
  suspendedAt: number | null;
  decidedAt: number | null;
  publishingAt: number | null;
  finishedAt: number | null;
  approve: () => void;
  reject: () => void;
  reset: () => void;
}

const DemoRunContext = createContext<DemoRun | null>(null);

export function DemoRunProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<DemoPhase>("boot");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [suspendedAt, setSuspendedAt] = useState<number | null>(null);
  const [decidedAt, setDecidedAt] = useState<number | null>(null);
  const [publishingAt, setPublishingAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  useEffect(() => {
    let id: number;
    if (phase === "boot") {
      id = window.setTimeout(() => {
        setStartedAt(Date.now());
        setPhase("research");
      }, 700);
    } else if (phase === "research") {
      id = window.setTimeout(() => {
        setSuspendedAt(Date.now());
        setPhase("suspended");
      }, RESEARCH_MS);
    } else if (phase === "writing") {
      id = window.setTimeout(() => {
        setPublishingAt(Date.now());
        setPhase("publishing");
      }, WRITE_MS);
    } else if (phase === "publishing") {
      id = window.setTimeout(() => {
        setFinishedAt(Date.now());
        setPhase("completed");
      }, PUBLISH_MS);
    }
    return () => window.clearTimeout(id);
  }, [phase]);

  const approve = useCallback(() => {
    setDecidedAt(Date.now());
    setPhase((p) => (p === "suspended" ? "writing" : p));
  }, []);

  const reject = useCallback(() => {
    const now = Date.now();
    setDecidedAt(now);
    setFinishedAt(now);
    setPhase((p) => (p === "suspended" ? "rejected" : p));
  }, []);

  const reset = useCallback(() => {
    setStartedAt(null);
    setSuspendedAt(null);
    setDecidedAt(null);
    setPublishingAt(null);
    setFinishedAt(null);
    setPhase("boot");
  }, []);

  const value = useMemo<DemoRun>(
    () => ({
      phase,
      startedAt,
      suspendedAt,
      decidedAt,
      publishingAt,
      finishedAt,
      approve,
      reject,
      reset,
    }),
    [phase, startedAt, suspendedAt, decidedAt, publishingAt, finishedAt, approve, reject, reset],
  );

  return <DemoRunContext.Provider value={value}>{children}</DemoRunContext.Provider>;
}

export function useDemoRun(): DemoRun {
  const ctx = useContext(DemoRunContext);
  if (!ctx) throw new Error("useDemoRun must be used inside DemoRunProvider");
  return ctx;
}

/* ----------------------------------------------------------------------- */
/* Small time + streaming hooks shared by the landing artifacts.            */
/* ----------------------------------------------------------------------- */

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Ticking clock — re-renders the consumer every `interval` while active. */
export function useNow(active: boolean, interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const sync = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => {
      window.clearTimeout(sync);
      window.clearInterval(id);
    };
  }, [active, interval]);
  return now;
}

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Streams text word by word over `totalMs`. Under prefers-reduced-motion the
 * full text renders immediately — streaming is content, not decoration.
 */
export function useStream(text: string, active: boolean, totalMs: number) {
  const words = useMemo(() => text.match(/\S+\s*/g) ?? [], [text]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) {
      const id = window.setTimeout(() => setCount(words.length), 0);
      return () => window.clearTimeout(id);
    }
    const interval = Math.max(16, totalMs / words.length);
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= words.length) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, interval);
    return () => window.clearInterval(id);
  }, [active, words, totalMs]);

  return {
    text: words.slice(0, count).join(""),
    done: count >= words.length && words.length > 0,
    started: count > 0,
  };
}

/** Reveals `total` items one at a time over `totalMs` (e.g. log lines). */
export function useSequence(total: number, active: boolean, totalMs: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) {
      const id = window.setTimeout(() => setCount(total), 0);
      return () => window.clearTimeout(id);
    }
    const interval = Math.max(60, totalMs / total);
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= total) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, interval);
    return () => window.clearInterval(id);
  }, [active, total, totalMs]);
  return count;
}
