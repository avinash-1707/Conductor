"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunDetailResponse, RunEvent, RunStepResource } from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { useRunEvents } from "@/lib/use-run-events";
import { Skeleton } from "@/components/app/view-state";
import { Button } from "@/components/app/ui";
import { RunDetail } from "@/components/app/run-detail";

const RUN_TERMINAL = new Set(["completed", "failed", "cancelled", "rejected", "expired"]);

/** Optimistically fold one live event into the cached run detail for an instant rail. */
function patchRunDetail(prev: RunDetailResponse | undefined, event: RunEvent): RunDetailResponse | undefined {
  if (!prev) return prev;
  if (event.type === "run.status") {
    return {
      ...prev,
      run: {
        ...prev.run,
        status: event.status,
        startedAt: event.status === "running" && !prev.run.startedAt ? event.at : prev.run.startedAt,
        completedAt:
          RUN_TERMINAL.has(event.status) && !prev.run.completedAt ? event.at : prev.run.completedAt,
      },
    };
  }
  if (event.type === "step.status") {
    const done = event.status === "completed" || event.status === "failed";
    const existing = prev.steps.find((s) => s.stepKind === event.step);
    let steps: RunStepResource[];
    if (existing) {
      steps = prev.steps.map((s) =>
        s.stepKind === event.step
          ? {
              ...s,
              status: event.status,
              attempt: Math.max(s.attempt, event.attempt),
              startedAt: s.startedAt ?? event.at,
              completedAt: done && !s.completedAt ? event.at : s.completedAt,
            }
          : s,
      );
    } else {
      // Event arrived before the projection row was cached — show it immediately.
      const placeholder: RunStepResource = {
        id: `placeholder-${event.step}`,
        stepKind: event.step,
        status: event.status,
        attempt: event.attempt,
        input: null,
        output: null,
        error: null,
        startedAt: event.at,
        completedAt: done ? event.at : null,
        llmObservations: [],
      };
      steps = [...prev.steps, placeholder];
    }
    return { ...prev, steps };
  }
  return prev;
}

function RunDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const client = useQueryClient();

  const query = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.runs.get(id),
    retry: (count, err) => (err instanceof ApiError && err.status === 404 ? false : count < 1),
  });

  // Live: patch the cache for an instant rail, then debounce an invalidation to
  // pull authoritative attempts/outputs/timestamps. `invalidateQueries` (bound
  // to the stable query client) avoids depending on the changing query object.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useCallback(
    (event: RunEvent) => {
      client.setQueryData<RunDetailResponse>(["run", id], (prev) =>
        patchRunDetail(prev, event),
      );
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        void client.invalidateQueries({ queryKey: ["run", id] });
      }, 200);
    },
    [client, id],
  );
  const onReconnect = useCallback(
    () => void client.invalidateQueries({ queryKey: ["run", id] }),
    [client, id],
  );
  useRunEvents(id, onEvent, { onReconnect });

  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  if (query.status === "pending") return <RunDetailSkeleton />;

  if (query.status === "error") {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line py-20 text-center">
        <p className="max-w-sm text-sm text-muted">
          {notFound
            ? "We couldn't find that run. It may belong to another organization, or the link is wrong."
            : "We couldn't load this run. Check your connection and try again."}
        </p>
        {notFound ? (
          <Link
            href="/runs"
            className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface/50 px-3 text-xs font-medium text-ink transition-colors hover:bg-raised"
          >
            Back to runs
          </Link>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return <RunDetail detail={query.data} />;
}
