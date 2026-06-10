"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { ApprovalListResponse, ApprovalResource, RunEvent } from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { APPROVALS_QUERY_KEY } from "@/lib/use-approvals";
import { useRunEvents } from "@/lib/use-run-events";
import { relativeTime, shortRunId } from "@/lib/format";
import { Button, Spinner } from "./ui";
import { useToast } from "./toast";

function dropFromCache(
  old: InfiniteData<ApprovalListResponse> | undefined,
  id: string,
): InfiniteData<ApprovalListResponse> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((p) => ({ ...p, items: p.items.filter((a) => a.id !== id) })),
  };
}

export function ApprovalCard({
  approval,
  focused = false,
}: {
  approval: ApprovalResource;
  focused?: boolean;
}) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(focused);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Deep link (?id=) — expand + scroll into view.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  // If another reviewer decides (or the gate expires), the run leaves
  // `suspended` — drop the now-stale card.
  const onRunEvent = useCallback(
    (event: RunEvent) => {
      if (event.type === "run.status" && event.status !== "suspended") {
        void client.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY });
      }
    },
    [client],
  );
  useRunEvents(approval.runId, onRunEvent);

  function decideMutation(verb: "approve" | "reject") {
    return {
      mutationFn: () =>
        verb === "approve" ? api.approvals.approve(approval.id) : api.approvals.reject(approval.id),
      onMutate: async () => {
        await client.cancelQueries({ queryKey: APPROVALS_QUERY_KEY });
        const prev = client.getQueryData<InfiniteData<ApprovalListResponse>>(APPROVALS_QUERY_KEY);
        client.setQueryData<InfiniteData<ApprovalListResponse>>(APPROVALS_QUERY_KEY, (old) =>
          dropFromCache(old, approval.id),
        );
        return { prev };
      },
      onError: (err: unknown, _v: void, ctx?: { prev?: InfiniteData<ApprovalListResponse> }) => {
        if (ctx?.prev) client.setQueryData(APPROVALS_QUERY_KEY, ctx.prev);
        const alreadyDecided = err instanceof ApiError && err.status === 409;
        toast(
          alreadyDecided
            ? "That request was already decided by someone else."
            : "We couldn't save your decision. Try again.",
          "error",
        );
      },
      onSuccess: () => toast(verb === "approve" ? "Approved" : "Rejected"),
      onSettled: () => client.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY }),
    };
  }

  const approve = useMutation(decideMutation("approve"));
  const reject = useMutation(decideMutation("reject"));
  const busy = approve.isPending || reject.isPending;

  const { research, draft } = approval.context;

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg border border-line-soft border-l-[3px] border-l-suspended bg-surface"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/runs/${approval.runId}`}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-faint transition-colors hover:text-accent"
          >
            run {shortRunId(approval.runId)}
            <ExternalLink className="h-3 w-3" />
          </Link>
          <span className="text-xs text-faint" title={approval.createdAt} suppressHydrationWarning>
            {relativeTime(approval.createdAt)}
          </span>
        </div>

        <p className="text-sm text-ink">{research.summary}</p>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Hide context" : "Show context"}
        </button>

        {expanded && (
          <div className="flex max-h-96 flex-col gap-4 overflow-y-auto rounded-md bg-inset p-3">
            <section className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Key points</h4>
              <ul className="list-disc pl-4 text-xs text-ink">
                {research.keyPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Sources</h4>
              <ul className="flex flex-col gap-1.5 text-xs">
                {research.sources.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      {s.title}
                    </a>
                    <span className="text-faint"> — {s.takeaway}</span>
                  </li>
                ))}
              </ul>
            </section>
            {draft && (
              <section className="flex flex-col gap-1.5">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
                  Draft · {draft.title} · {draft.wordCount} words
                </h4>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink">
                  {draft.markdown}
                </pre>
              </section>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
        {confirmingReject ? (
          <>
            <span className="mr-auto text-xs text-muted">
              Reject this run? It stops here and nothing is published.
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingReject(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => reject.mutate()}
            >
              {reject.isPending && <Spinner className="h-3.5 w-3.5" />}
              Confirm reject
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingReject(true)}
              className="text-failed"
            >
              Reject
            </Button>
            <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
              {approve.isPending && <Spinner className="h-3.5 w-3.5" />}
              Approve
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
