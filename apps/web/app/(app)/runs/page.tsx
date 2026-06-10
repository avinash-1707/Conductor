"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { LayoutList } from "lucide-react";
import { api } from "@/lib/api";
import { useConnectionStatus } from "@/lib/use-run-events";
import { Button } from "@/components/app/ui";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/app/view-state";
import { RUNS_QUERY_KEY, RunsTable } from "@/components/app/runs-table";
import { OnboardingChecklist } from "@/components/app/onboarding-checklist";

export default function RunsPage() {
  const query = useInfiniteQuery({
    queryKey: RUNS_QUERY_KEY,
    queryFn: ({ pageParam }) => api.runs.list({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // On socket reconnect (live again after a drop), refetch to reconcile the
  // tail that may have been missed while offline.
  const status = useConnectionStatus();
  const wasDropped = useRef(false);
  useEffect(() => {
    if (status === "reconnecting" || status === "offline") wasDropped.current = true;
    else if (status === "live" && wasDropped.current) {
      wasDropped.current = false;
      void query.refetch();
    }
  }, [status, query]);

  const runs = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Every pipeline run for your organization shows up here, live — the ones
        needing attention rise to the top.
      </p>

      {/* First-run onboarding (Unit 23) — hides itself once complete. */}
      {query.status === "success" && (
        <OnboardingChecklist hasRuns={runs.length > 0} />
      )}

      {query.status === "pending" ? (
        <SkeletonRows rows={6} />
      ) : query.status === "error" ? (
        <ErrorState
          message="We couldn't load your runs. Check your connection and try again."
          onRetry={() => void query.refetch()}
        />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          message="No runs yet. Launch one from the Workflow Library to see it stream here."
          action={
            <Link
              href="/workflows"
              className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-fill)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-fill-hi)]"
            >
              Browse workflows
            </Link>
          }
        />
      ) : (
        <>
          <RunsTable runs={runs} />
          {query.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
