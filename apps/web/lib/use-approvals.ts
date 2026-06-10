"use client";

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { ApprovalListResponse } from "@conductor/shared";
import { api } from "./api";

/** Shared key so the page and the sidebar badge read one cache entry. */
export const APPROVALS_QUERY_KEY = ["approvals"] as const;

/** The pending-approvals queue (cursor-paginated, newest first). */
export function useApprovalsQuery() {
  return useInfiniteQuery({
    queryKey: APPROVALS_QUERY_KEY,
    queryFn: ({ pageParam }) => api.approvals.list({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Badge label: "" (hidden), "N", or "N+" when more pages exist. */
export function pendingCountLabel(
  data: InfiniteData<ApprovalListResponse> | undefined,
): string {
  if (!data) return "";
  const count = data.pages.reduce((n, p) => n + p.items.length, 0);
  if (count === 0) return "";
  const more = data.pages[data.pages.length - 1]?.nextCursor != null;
  return more ? `${count}+` : String(count);
}
