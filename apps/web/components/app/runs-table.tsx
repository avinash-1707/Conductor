"use client";

import Link from "next/link";
import { useCallback } from "react";
import {
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { RunEvent, RunListResponse, RunResource, RunStatus } from "@conductor/shared";
import { useRunEvents } from "@/lib/use-run-events";
import { useElapsed } from "@/lib/use-elapsed";
import { relativeTime, shortRunId, workflowLabel } from "@/lib/format";
import { StatusBadge } from "./status-badge";

/** Shared query key for the paginated dashboard feed. */
export const RUNS_QUERY_KEY = ["runs"] as const;

/** A run still climbing time (counts toward the live duration). */
const TICKING: ReadonlySet<RunStatus> = new Set<RunStatus>(["running", "suspended"]);

/** Terminal states freeze the duration and sort to the bottom. */
const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "rejected",
  "expired",
]);

// Attention-first: things needing a human first, then active, then done.
const PRIORITY: Record<RunStatus, number> = {
  suspended: 0,
  failed: 1,
  running: 2,
  pending: 3,
  completed: 4,
  rejected: 4,
  expired: 4,
  cancelled: 4,
};

/** Bucket by attention priority, newest-first within each bucket. */
export function attentionFirst(runs: RunResource[]): RunResource[] {
  return [...runs].sort((a, b) => {
    const p = PRIORITY[a.status] - PRIORITY[b.status];
    if (p !== 0) return p;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Patch one run's live status across every loaded infinite page, in place, so
 * the badge + bucket update with no refetch. A `run.status` event carries no
 * timestamps, so we synthesize `startedAt`/`completedAt` from the event's `at`
 * when missing — reconciled exactly on the next refetch.
 */
function patchRunStatus(client: QueryClient, runId: string, status: RunStatus, at: string) {
  client.setQueryData<InfiniteData<RunListResponse>>(RUNS_QUERY_KEY, (old) => {
    if (!old) return old;
    let changed = false;
    const pages = old.pages.map((page) => {
      let pageChanged = false;
      const items = page.items.map((run) => {
        if (run.id !== runId || run.status === status) return run;
        pageChanged = true;
        changed = true;
        return {
          ...run,
          status,
          startedAt: status === "running" && !run.startedAt ? at : run.startedAt,
          completedAt:
            TERMINAL.has(status) && !run.completedAt ? at : run.completedAt,
        };
      });
      return pageChanged ? { ...page, items } : page;
    });
    return changed ? { ...old, pages } : old;
  });
}

function RunRow({ run }: { run: RunResource }) {
  const client = useQueryClient();

  const onEvent = useCallback(
    (event: RunEvent) => {
      if (event.type === "run.status") {
        patchRunStatus(client, event.runId, event.status, event.at);
      }
    },
    [client],
  );
  useRunEvents(run.id, onEvent);

  const duration = useElapsed(run.startedAt, run.completedAt, TICKING.has(run.status));

  return (
    <Link
      href={`/runs/${run.id}`}
      className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-4 rounded-lg border border-line-soft bg-surface px-4 py-3 transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[8rem_1fr_10rem_5rem_4.5rem]"
    >
      <StatusBadge status={run.status} />

      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{workflowLabel(run.workflowName)}</p>
        <p className="truncate font-mono text-xs text-faint sm:hidden">
          {shortRunId(run.id)}
        </p>
      </div>

      <span className="hidden font-mono text-xs text-faint sm:block" title={run.id}>
        {shortRunId(run.id)}
      </span>

      <span
        className="hidden text-xs text-faint sm:block"
        title={run.createdAt}
        suppressHydrationWarning
      >
        {relativeTime(run.createdAt)}
      </span>

      <span className="text-right font-mono text-xs text-faint" suppressHydrationWarning>
        {duration}
      </span>
    </Link>
  );
}

export function RunsTable({ runs }: { runs: RunResource[] }) {
  const sorted = attentionFirst(runs);
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden grid-cols-[8rem_1fr_10rem_5rem_4.5rem] gap-4 px-4 text-xs font-medium uppercase tracking-wide text-muted sm:grid">
        <span>Status</span>
        <span>Pipeline</span>
        <span>Run ID</span>
        <span>Started</span>
        <span className="text-right">Duration</span>
      </div>
      {sorted.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}
