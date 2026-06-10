"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { useApprovalsQuery } from "@/lib/use-approvals";
import { useConnectionStatus } from "@/lib/use-run-events";
import { Button } from "@/components/app/ui";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/app/view-state";
import { ApprovalCard } from "@/components/app/approval-card";

function ApprovalsQueue() {
  const query = useApprovalsQuery();
  const focusId = useSearchParams().get("id");

  // Reconnect → refetch to reconcile the queue (same pattern as /runs).
  const status = useConnectionStatus();
  const wasDropped = useRef(false);
  useEffect(() => {
    if (status === "reconnecting" || status === "offline") wasDropped.current = true;
    else if (status === "live" && wasDropped.current) {
      wasDropped.current = false;
      void query.refetch();
    }
  }, [status, query]);

  const approvals = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Runs paused for your review. Approve to resume, or reject to stop.
      </p>

      {query.status === "pending" ? (
        <SkeletonRows rows={4} />
      ) : query.status === "error" ? (
        <ErrorState
          message="We couldn't load your approvals. Check your connection and try again."
          onRetry={() => void query.refetch()}
        />
      ) : approvals.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          message="Nothing is waiting on you. Approvals from your runs will appear here."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {approvals.map((a) => (
              <ApprovalCard key={a.id} approval={a} focused={a.id === focusId} />
            ))}
          </div>
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

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <ApprovalsQueue />
    </Suspense>
  );
}
