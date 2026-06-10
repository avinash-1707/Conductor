"use client";

import type {
  RunResource,
  RunStatus,
  RunStepResource,
  StepStatus,
} from "@conductor/shared";
import { useElapsed } from "@/lib/use-elapsed";
import { StatusBadge, StatusDot } from "./status-badge";

type AnyStatus = RunStatus | StepStatus;

export type RailNodeKey = "research" | "approval" | "write" | "publish";

export interface RailNode {
  key: RailNodeKey;
  label: string;
  status: AnyStatus;
  /** The projection step row (absent for the synthetic approval gate). */
  step?: RunStepResource;
}

/** Whether a node's duration counter should still climb. */
const TICKING: ReadonlySet<AnyStatus> = new Set<AnyStatus>(["running", "retrying"]);

/**
 * Derives the synthetic approval-gate status from the run + steps (the gate is
 * an event + record, never a step kind — status.ts). Granted if the run moved
 * past it (a write step exists, or the run completed).
 */
function approvalStatus(run: RunResource, hasWrite: boolean): AnyStatus {
  if (run.status === "suspended") return "suspended";
  if (run.status === "rejected") return "rejected";
  if (run.status === "expired") return "expired";
  if (hasWrite || run.status === "completed") return "completed";
  return "pending";
}

/** Builds the fixed four-node rail. Pure — shape is unit-testable. */
export function buildRailNodes(run: RunResource, steps: RunStepResource[]): RailNode[] {
  const byKind = new Map(steps.map((s) => [s.stepKind, s]));
  const research = byKind.get("research");
  const write = byKind.get("write");
  const publish = byKind.get("publish");
  return [
    { key: "research", label: "research", status: research?.status ?? "pending", step: research },
    { key: "approval", label: "approval", status: approvalStatus(run, byKind.has("write")) },
    { key: "write", label: "write", status: write?.status ?? "pending", step: write },
    { key: "publish", label: "publish", status: publish?.status ?? "pending", step: publish },
  ];
}

function StepCard({
  node,
  selected,
  onSelect,
}: {
  node: RailNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const duration = useElapsed(
    node.step?.startedAt ?? null,
    node.step?.completedAt ?? null,
    TICKING.has(node.status),
  );
  const showError =
    (node.status === "failed" || node.status === "retrying") && node.step?.error;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected ? "border-accent/60 ring-1 ring-accent/40" : "border-line-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-ink">{node.label}</span>
        <StatusBadge status={node.status} />
      </div>
      <div className="mt-1 flex items-center gap-3 font-mono text-xs text-faint">
        {node.step && node.step.attempt > 1 && (
          <span className="text-retrying">attempt {node.step.attempt}</span>
        )}
        {node.step?.startedAt && <span>{duration}</span>}
      </div>
      {showError && (
        <p className="mt-1.5 line-clamp-2 text-xs text-failed">{node.step?.error}</p>
      )}
    </button>
  );
}

export function TimelineRail({
  nodes,
  selectedKey,
  onSelect,
}: {
  nodes: RailNode[];
  selectedKey: RailNodeKey;
  onSelect: (key: RailNodeKey) => void;
}) {
  return (
    <ol className="relative flex flex-col gap-3">
      {/* Connector line behind the dots. */}
      <span
        className="absolute bottom-3 left-[5.5px] top-3 w-px bg-line"
        aria-hidden
      />
      {nodes.map((node) => (
        <li key={node.key} className="relative flex items-start gap-3">
          <span className="relative z-10 mt-3 shrink-0">
            <StatusDot status={node.status} />
          </span>
          <div className="min-w-0 flex-1">
            <StepCard
              node={node}
              selected={node.key === selectedKey}
              onSelect={() => onSelect(node.key)}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
