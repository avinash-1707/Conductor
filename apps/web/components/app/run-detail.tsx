"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import {
  blogPostPipelineInputSchema,
  type RunDetailResponse,
  type RunResource,
  type TokenStreamEvent,
} from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { useElapsed } from "@/lib/use-elapsed";
import { useRunStream } from "@/lib/use-run-events";
import { relativeTime, shortRunId, workflowLabel } from "@/lib/format";
import { Button, Spinner } from "./ui";
import { useToast } from "./toast";
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

/**
 * The failure strip (Unit 22) — rendered exactly where the failure is shown
 * (ui-context IA). Resuming starts a new linked run from the last successful
 * step using stored outputs; on success we follow it, and it goes live over
 * the page's existing socket subscription.
 */
function ResumeStrip({ run }: { run: RunResource }) {
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();

  const resume = useMutation({
    mutationFn: () => api.runs.resume(run.id),
    onSuccess: (newRun) => {
      toast("Resumed");
      void client.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${newRun.id}`);
    },
    onError: (err) => {
      toast(
        err instanceof ApiError
          ? err.message
          : "The run could not be resumed. Try again.",
        "error",
      );
    },
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-failed/40 bg-failed/10 px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-ink">
        {run.error ?? "This run failed."}
      </p>
      <Button
        size="sm"
        onClick={() => resume.mutate()}
        disabled={resume.isPending}
      >
        {resume.isPending && <Spinner className="h-3.5 w-3.5" />}
        Resume from last successful step
      </Button>
    </div>
  );
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

  // Launch params are template-shaped (Unit 26) — parse on read; the blog
  // summary renders only when they match, future templates fall back to the
  // run name (the inspector always shows the raw params).
  const launch = useMemo(() => {
    const parsed = blogPostPipelineInputSchema.safeParse(run.input);
    return parsed.success ? parsed.data : undefined;
  }, [run.input]);

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
          <p className="text-sm text-ink">
            {launch?.topic ?? workflowLabel(run.workflowName)}
          </p>
          <StatusBadge status={run.status} />
        </div>
        {run.resumedFromRunId && (
          <p className="text-xs text-muted">
            Resumed from{" "}
            <Link
              href={`/runs/${run.resumedFromRunId}`}
              className="font-mono text-accent transition-colors hover:text-accent-hi"
            >
              {shortRunId(run.resumedFromRunId)}
            </Link>
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Meta label="Tone" value={launch?.tone ?? "—"} />
          <Meta
            label="Target words"
            value={launch ? String(launch.wordCount) : "—"}
          />
          <Meta
            label="Started"
            value={run.startedAt ? relativeTime(run.startedAt) : "—"}
            title={run.startedAt ?? undefined}
          />
          <Meta label="Duration" value={totalDuration} />
        </div>
      </div>

      {run.status === "failed" && <ResumeStrip run={run} />}

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
