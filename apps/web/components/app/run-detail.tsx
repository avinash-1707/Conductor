"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { RunDetailResponse, TokenStreamEvent } from "@conductor/shared";
import { useElapsed } from "@/lib/use-elapsed";
import { useRunStream } from "@/lib/use-run-events";
import { relativeTime, shortRunId, workflowLabel } from "@/lib/format";
import { StatusBadge } from "./status-badge";
import {
  buildRailNodes,
  TimelineRail,
  type RailNode,
  type RailNodeKey,
} from "./timeline-rail";
import { PayloadInspector } from "./payload-inspector";

/** The node the inspector opens on by default: active step → gate → last done → research. */
function defaultSelected(detail: RunDetailResponse, nodes: RailNode[]): RailNodeKey {
  const active = nodes.find((n) => n.status === "running" || n.status === "retrying");
  if (active) return active.key;
  if (detail.run.status === "suspended") return "approval";
  const lastWithOutput = [...nodes].reverse().find((n) => n.step?.output != null);
  if (lastWithOutput) return lastWithOutput.key;
  return "research";
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-sm text-ink" title={title}>
        {value}
      </span>
    </div>
  );
}

export function RunDetail({ detail }: { detail: RunDetailResponse }) {
  const { run, steps } = detail;
  const nodes = useMemo(() => buildRailNodes(run, steps), [run, steps]);

  // Live LLM token streams, accumulated per step kind (Unit 20). Shown in the
  // inspector for a running step until its final output arrives on refetch.
  const [streams, setStreams] = useState<Record<string, { text: string; done: boolean }>>({});
  const onToken = useCallback((event: TokenStreamEvent) => {
    setStreams((prev) => {
      const cur = prev[event.step] ?? { text: "", done: false };
      if (event.type === "token") {
        return { ...prev, [event.step]: { text: cur.text + event.delta, done: false } };
      }
      return { ...prev, [event.step]: { ...cur, done: true } };
    });
  }, []);
  useRunStream(run.id, onToken);

  const [selectedKey, setSelectedKey] = useState<RailNodeKey>(() =>
    defaultSelected(detail, nodes),
  );
  // Follow the active step automatically until the user picks a node themselves.
  const userPicked = useRef(false);
  useEffect(() => {
    if (!userPicked.current) setSelectedKey(defaultSelected(detail, nodes));
  }, [detail, nodes]);

  const selected = nodes.find((n) => n.key === selectedKey) ?? nodes[0];

  const totalDuration = useElapsed(
    run.startedAt,
    run.completedAt,
    run.status === "running" || run.status === "suspended",
  );
  const isQueued = run.status === "pending" && steps.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/runs" className="transition-colors hover:text-ink">
          Runs
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-faint" />
        <span className="text-ink">{workflowLabel(run.workflowName)}</span>
        <span className="font-mono text-xs text-faint">· {shortRunId(run.id)}</span>
      </nav>

      {/* Summary */}
      <div className="flex flex-col gap-4 rounded-lg border border-line-soft bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink">{run.input.topic}</p>
          <StatusBadge status={run.status} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Meta label="Tone" value={run.input.tone} />
          <Meta label="Target words" value={String(run.input.wordCount)} />
          <Meta
            label="Started"
            value={run.startedAt ? relativeTime(run.startedAt) : "—"}
            title={run.startedAt ?? undefined}
          />
          <Meta label="Duration" value={totalDuration} />
        </div>
      </div>

      {isQueued && (
        <p className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs text-muted">
          This run is queued — its steps appear here as it starts.
        </p>
      )}

      {/* Two-column: timeline rail | payload inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <TimelineRail
          nodes={nodes}
          selectedKey={selectedKey}
          onSelect={(key) => {
            userPicked.current = true;
            setSelectedKey(key);
          }}
        />
        {selected && (
          <PayloadInspector
            node={selected}
            stream={selected.key !== "approval" ? streams[selected.key] : undefined}
          />
        )}
      </div>
    </div>
  );
}
