"use client";

import type { RunStatus, StepStatus } from "@conductor/shared";
import { StatusBadge } from "./status-badge";
import { JsonView } from "./json-view";
import type { RailNode } from "./timeline-rail";

type AnyStatus = RunStatus | StepStatus;

const APPROVAL_COPY: Partial<Record<AnyStatus, string>> = {
  suspended: "This run is paused, waiting for a reviewer to approve or reject the draft.",
  completed: "A reviewer approved this run, so it continued to the writing step.",
  rejected: "A reviewer rejected this run. It stopped here and nothing was published.",
  expired: "The approval window passed before anyone responded, so the run expired.",
  pending: "The research step has to finish before a reviewer is asked to approve.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-faint">{children}</p>;
}

export function PayloadInspector({ node }: { node: RailNode }) {
  return (
    <div className="sticky top-20 flex flex-col gap-4 rounded-lg border border-line-soft bg-inset p-4">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft pb-3">
        <span className="font-mono text-sm text-ink">{node.label}</span>
        <StatusBadge status={node.status} />
      </div>

      {node.key === "approval" ? (
        <p className="text-sm text-muted">
          {APPROVAL_COPY[node.status] ?? "Human approval gate."}
        </p>
      ) : (
        <>
          <Section title="Input">
            {node.step?.input != null ? (
              <JsonView value={node.step.input} />
            ) : (
              <Note>No input recorded.</Note>
            )}
          </Section>

          <Section title="Output">
            {node.step?.output != null ? (
              <JsonView value={node.step.output} />
            ) : node.status === "running" || node.status === "retrying" ? (
              <Note>Running… output appears when the step finishes.</Note>
            ) : node.status === "failed" ? (
              <p className="font-mono text-xs text-failed">
                {node.step?.error ?? "The step failed."}
              </p>
            ) : (
              <Note>No output yet.</Note>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
