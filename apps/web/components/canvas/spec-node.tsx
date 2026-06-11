"use client";

import { memo, type ComponentType } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { PenLine, Search, Send, UserCheck, type LucideProps } from "lucide-react";
import { activityRegistry, type GraphNode, type GraphNodeType } from "@conductor/shared";
import { StatusDot, statusBorderClass } from "@/components/app/status-badge";
import type { SpecFlowNode } from "./layout";

/**
 * The canvas step node (Unit 30) — the timeline rail's visual language
 * translated to the graph surface: surface card, mono step name, config in
 * mono, channels as port labels. Status (run-pinned views) tints the frame and
 * swaps the kind tag for the shared StatusDot; the running tone carries the
 * brand's single sanctioned pulse. Nothing here animates ambiently.
 */

const ICONS: Record<GraphNodeType, ComponentType<LucideProps>> = {
  research: Search,
  approval: UserCheck,
  write: PenLine,
  publish: Send,
};

/** Effective execution config, flagged when it overrides the registry default. */
function configLabel(node: GraphNode): { text: string; custom: boolean } {
  if (node.type === "approval") {
    const hours = node.config.timeoutHours;
    const fallback = activityRegistry.approval.defaults.timeoutHours;
    return {
      text: `${hours ?? fallback}h approval window`,
      custom: hours !== undefined,
    };
  }
  const defaults = activityRegistry[node.type].defaults;
  const timeout = node.config.timeoutSeconds;
  const attempts = node.config.maximumAttempts;
  return {
    text: `${timeout ?? defaults.timeoutSeconds}s timeout · ${attempts ?? defaults.maximumAttempts} attempts`,
    custom: timeout !== undefined || attempts !== undefined,
  };
}

export const SpecNode = memo(function SpecNode({
  data,
  selected,
  isConnectable,
}: NodeProps<SpecFlowNode>) {
  const { node, status, invalid } = data;
  const entry = activityRegistry[node.type];
  const Icon = ICONS[node.type];
  const config = configLabel(node);

  // Frame priority: a validation issue outranks status tint; selection adds
  // the accent ring on top (editor only — the viewer disables selection).
  const border = invalid
    ? "border-failed/50"
    : status
      ? statusBorderClass(status)
      : "border-line-soft";

  return (
    <div
      className={`w-[232px] rounded-lg border bg-surface px-3.5 py-3 shadow-[var(--shadow-card)] transition-colors duration-150 ${border} ${
        selected ? "ring-1 ring-accent/40 border-accent/60" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate font-mono text-sm text-ink">{node.id}</span>
        </span>
        {status ? (
          <StatusDot status={status} />
        ) : (
          <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
            {entry.kind}
          </span>
        )}
      </div>

      <p className={`mt-2 font-mono text-[11px] ${config.custom ? "text-muted" : "text-faint"}`}>
        {config.text}
      </p>

      {(entry.consumes.length > 0 || entry.produces) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-soft pt-2 font-mono text-[10px] text-faint">
          <span className="truncate">
            {entry.consumes.length > 0 ? `‹ ${entry.consumes.join(", ")}` : ""}
          </span>
          {entry.produces && (
            <span className="ml-auto shrink-0 text-muted">{entry.produces} ›</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
