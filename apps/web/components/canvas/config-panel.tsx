"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import {
  activityRegistry,
  type ActivityNodeConfig,
  type ApprovalNodeConfig,
  type GraphNode,
} from "@conductor/shared";
import { Button, Field, Input } from "@/components/app/ui";
import type { SpecFlowNode } from "./layout";
import { slugError } from "./editor-state";

/**
 * Per-node configuration (Unit 31). Blank fields mean "registry default" —
 * the config key is omitted from the spec, exactly how curated templates
 * store defaults. Out-of-range values are committed and flagged by the shared
 * schema (one validator narrates every rule).
 */

function numberValue(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Step id editor — drafts locally, commits on blur/submit only when valid. */
function IdField({
  node,
  takenIds,
  onRename,
}: {
  node: GraphNode;
  takenIds: string[];
  onRename: (oldId: string, newId: string) => void;
}) {
  const [draft, setDraft] = useState(node.id);
  const error = draft === node.id ? null : slugError(draft, takenIds);

  function commit(e?: FormEvent) {
    e?.preventDefault();
    if (draft !== node.id && !error) onRename(node.id, draft);
  }

  return (
    <form onSubmit={commit} className="flex flex-col gap-1.5">
      <Field label="Step id" htmlFor="node-id" hint="Shows on the canvas and in run history.">
        <Input
          id="node-id"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          className="font-mono"
        />
      </Field>
      {error && <p className="text-xs text-failed">{error}</p>}
    </form>
  );
}

function ActivityConfigFields({
  node,
  onChange,
}: {
  node: GraphNode & { type: "research" | "write" | "publish" };
  onChange: (config: ActivityNodeConfig) => void;
}) {
  const defaults = activityRegistry[node.type].defaults;
  return (
    <>
      <Field
        label="Timeout (seconds)"
        htmlFor="node-timeout"
        hint={`Blank = default (${defaults.timeoutSeconds}s). 1–600.`}
      >
        <Input
          id="node-timeout"
          type="number"
          min={1}
          max={600}
          placeholder={String(defaults.timeoutSeconds)}
          value={node.config.timeoutSeconds ?? ""}
          onChange={(e) =>
            onChange({ ...node.config, timeoutSeconds: numberValue(e.target.value) })
          }
        />
      </Field>
      <Field
        label="Max attempts"
        htmlFor="node-attempts"
        hint={`Blank = default (${defaults.maximumAttempts}). 1–10.`}
      >
        <Input
          id="node-attempts"
          type="number"
          min={1}
          max={10}
          placeholder={String(defaults.maximumAttempts)}
          value={node.config.maximumAttempts ?? ""}
          onChange={(e) =>
            onChange({ ...node.config, maximumAttempts: numberValue(e.target.value) })
          }
        />
      </Field>
    </>
  );
}

function ApprovalConfigFields({
  node,
  onChange,
}: {
  node: GraphNode & { type: "approval" };
  onChange: (config: ApprovalNodeConfig) => void;
}) {
  const defaults = activityRegistry.approval.defaults;
  return (
    <Field
      label="Approval window (hours)"
      htmlFor="node-hours"
      hint={`Blank = default (${defaults.timeoutHours}h). The run expires unanswered. 1–168.`}
    >
      <Input
        id="node-hours"
        type="number"
        min={1}
        max={168}
        placeholder={String(defaults.timeoutHours)}
        value={node.config.timeoutHours ?? ""}
        onChange={(e) => onChange({ timeoutHours: numberValue(e.target.value) })}
      />
    </Field>
  );
}

export function ConfigPanel({
  node,
  takenIds,
  onConfigChange,
  onRename,
  onDelete,
}: {
  node: SpecFlowNode | null;
  /** Ids of OTHER nodes (rename collision check). */
  takenIds: string[];
  onConfigChange: (id: string, config: GraphNode["config"]) => void;
  onRename: (oldId: string, newId: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!node) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4">
        <p className="text-xs text-muted">
          Select a step on the canvas to configure it.
        </p>
      </div>
    );
  }

  const graphNode = node.data.node;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line-soft bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted">Configure step</h2>
        <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
          {graphNode.type}
        </span>
      </div>

      {/* Keyed so the id draft resets when the selection moves. */}
      <IdField key={node.id} node={graphNode} takenIds={takenIds} onRename={onRename} />

      {graphNode.type === "approval" ? (
        <ApprovalConfigFields
          node={graphNode}
          onChange={(config) => onConfigChange(node.id, config)}
        />
      ) : (
        <ActivityConfigFields
          node={graphNode}
          onChange={(config) => onConfigChange(node.id, config)}
        />
      )}

      <div className="border-t border-line-soft pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-failed hover:text-failed"
          onClick={() => onDelete(node.id)}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove step
        </Button>
      </div>
    </div>
  );
}
