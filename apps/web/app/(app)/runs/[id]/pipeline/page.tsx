"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useRunEvents } from "@/lib/use-run-events";
import { shortRunId, workflowLabel } from "@/lib/format";
import { Button } from "@/components/app/ui";
import { Skeleton } from "@/components/app/view-state";
import { StatusBadge } from "@/components/app/status-badge";
import { buildRailNodes } from "@/components/app/timeline-rail";
import { SpecCanvas } from "@/components/canvas/spec-canvas";
import type { NodeStatus } from "@/components/canvas/layout";

/**
 * A run's pinned pipeline (Unit 30) — the exact graph_spec version the run
 * executes, rendered on the read-only canvas with live step statuses. The
 * spec comes from the immutable definition row the run pinned at launch, so
 * this view never drifts even after the template rolls forward.
 */

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-[320px] w-full rounded-xl lg:h-[380px]" />
    </div>
  );
}

function Message({
  text,
  backHref,
  backLabel,
  onRetry,
}: {
  text: string;
  backHref?: string;
  backLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line py-20 text-center">
      <p className="max-w-sm text-sm text-muted">{text}</p>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface/50 px-3 text-xs font-medium text-ink transition-colors hover:bg-raised"
        >
          {backLabel}
        </Link>
      )}
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export default function RunPipelinePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const client = useQueryClient();

  const runQuery = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.runs.get(id),
    retry: (count, err) =>
      err instanceof ApiError && err.status === 404 ? false : count < 1,
  });

  const definitionId = runQuery.data?.run.definitionId ?? null;
  const definitionQuery = useQuery({
    queryKey: ["definition", definitionId],
    queryFn: () => api.definitions.get(definitionId!),
    enabled: definitionId !== null,
    // Version rows are immutable — once fetched, never refetch.
    staleTime: Infinity,
  });

  // Live: any status event refreshes the shared run cache, so the node tints
  // here move with the run (the pinned spec itself never changes).
  const onEvent = useCallback(
    () => void client.invalidateQueries({ queryKey: ["run", id] }),
    [client, id],
  );
  useRunEvents(id, onEvent, { onReconnect: onEvent });

  // Step statuses by node id: rail nodes are keyed by step kind, and node ids
  // map to kinds through the spec's own node list.
  const statuses = useMemo(() => {
    const detail = runQuery.data;
    const spec = definitionQuery.data?.graphSpec;
    if (!detail || !spec) return undefined;
    const byKind = new Map(
      buildRailNodes(detail.run, detail.steps).map((node) => [node.key, node.status]),
    );
    const map: Partial<Record<string, NodeStatus>> = {};
    for (const node of spec.nodes) {
      const status = byKind.get(node.type);
      if (status) map[node.id] = status;
    }
    return map;
  }, [runQuery.data, definitionQuery.data]);

  if (runQuery.status === "pending") return <PageSkeleton />;

  if (runQuery.status === "error") {
    const notFound = runQuery.error instanceof ApiError && runQuery.error.status === 404;
    return notFound ? (
      <Message
        text="We couldn't find that run. It may belong to another organization, or the link is wrong."
        backHref="/runs"
        backLabel="Back to runs"
      />
    ) : (
      <Message
        text="We couldn't load this run. Check your connection and try again."
        onRetry={() => void runQuery.refetch()}
      />
    );
  }

  const { run } = runQuery.data;

  const breadcrumb = (
    <nav
      className="flex flex-wrap items-center gap-1.5 text-sm text-muted"
      aria-label="Breadcrumb"
    >
      <Link href="/runs" className="transition-colors hover:text-ink">
        Runs
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-faint" />
      <Link href={`/runs/${run.id}`} className="transition-colors hover:text-ink">
        {workflowLabel(run.workflowName)}
        <span className="font-mono text-xs text-faint"> · {shortRunId(run.id)}</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-faint" />
      <span className="text-ink">Pipeline</span>
      {definitionQuery.data && (
        <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] text-faint">
          pinned v{definitionQuery.data.version}
        </span>
      )}
      <StatusBadge status={run.status} className="ml-auto" />
    </nav>
  );

  if (!definitionId) {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        <Message
          text="This run predates pipeline views, so there is no pinned pipeline to show."
          backHref={`/runs/${run.id}`}
          backLabel="Back to the run"
        />
      </div>
    );
  }

  if (definitionQuery.status === "pending") return <PageSkeleton />;

  if (definitionQuery.status === "error" || !definitionQuery.data.graphSpec) {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        {definitionQuery.status === "error" ? (
          <Message
            text="The pinned pipeline couldn't be loaded."
            onRetry={() => void definitionQuery.refetch()}
          />
        ) : (
          <Message
            text="This run's definition predates pipeline specs, so there is nothing to draw."
            backHref={`/runs/${run.id}`}
            backLabel="Back to the run"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {breadcrumb}
      <SpecCanvas spec={definitionQuery.data.graphSpec} statuses={statuses} />
      <p className="text-xs text-muted">
        This is the exact pipeline version this run pinned at launch — later
        template changes never affect it.
      </p>
    </div>
  );
}
