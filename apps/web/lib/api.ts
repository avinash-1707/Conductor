"use client";

import {
  approvalListResponseSchema,
  approvalResourceSchema,
  blogPostPipelineInputSchema,
  runDetailResponseSchema,
  runListResponseSchema,
  runSchema,
  type ApprovalListResponse,
  type ApprovalResource,
  type BlogPostPipelineInput,
  type RunDetailResponse,
  type RunListResponse,
  type RunResource,
} from "@conductor/shared";
import { z } from "zod";
import { SERVER_URL } from "./config";
import { clearApiJwt, getApiJwt } from "./jwt";

/** A typed error mirroring the server's `{ error: { code, message } }` shape. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

type Options<T> = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  schema: z.ZodType<T>;
  /** Internal: set on the retry after a forced JWT refresh. */
  _retried?: boolean;
};

/**
 * The single door to apps/server. Attaches the API JWT, parses success bodies
 * against a shared Zod schema (architecture invariant 5 — never trust an
 * unvalidated response), maps error envelopes to `ApiError`, and refreshes the
 * JWT once on a 401 before giving up. Components never call `fetch` directly.
 */
async function apiFetch<T>(path: string, opts: Options<T>): Promise<T> {
  const token = await getApiJwt(opts._retried === true);
  if (!token) {
    throw new ApiError("unauthenticated", "Your session has expired", 401);
  }

  const res = await fetch(`${SERVER_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts._retried !== true) {
    clearApiJwt();
    return apiFetch(path, { ...opts, _retried: true });
  }

  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
    if (parsed.success) {
      throw new ApiError(parsed.data.error.code, parsed.data.error.message, res.status);
    }
    throw new ApiError("unknown", `Request failed (${res.status})`, res.status);
  }

  return opts.schema.parse(await res.json());
}

export const api = {
  runs: {
    list: (params?: { cursor?: string; limit?: number }): Promise<RunListResponse> => {
      const q = new URLSearchParams();
      if (params?.cursor) q.set("cursor", params.cursor);
      if (params?.limit) q.set("limit", String(params.limit));
      const qs = q.toString();
      return apiFetch(`/runs${qs ? `?${qs}` : ""}`, { schema: runListResponseSchema });
    },
    get: (id: string): Promise<RunDetailResponse> =>
      apiFetch(`/runs/${id}`, { schema: runDetailResponseSchema }),
    create: (input: BlogPostPipelineInput): Promise<RunResource> =>
      apiFetch(`/runs`, {
        method: "POST",
        body: blogPostPipelineInputSchema.parse(input),
        schema: runSchema,
      }),
  },
  approvals: {
    list: (params?: { cursor?: string; limit?: number }): Promise<ApprovalListResponse> => {
      const q = new URLSearchParams();
      if (params?.cursor) q.set("cursor", params.cursor);
      if (params?.limit) q.set("limit", String(params.limit));
      const qs = q.toString();
      return apiFetch(`/approvals${qs ? `?${qs}` : ""}`, {
        schema: approvalListResponseSchema,
      });
    },
    approve: (id: string): Promise<ApprovalResource> =>
      apiFetch(`/approvals/${id}/approve`, {
        method: "POST",
        schema: approvalResourceSchema,
      }),
    reject: (id: string): Promise<ApprovalResource> =>
      apiFetch(`/approvals/${id}/reject`, {
        method: "POST",
        schema: approvalResourceSchema,
      }),
  },
  orgApiKey: {
    get: (): Promise<{ configured: boolean; last4: string | null }> =>
      apiFetch(`/orgs/api-key`, {
        schema: z.object({
          configured: z.boolean(),
          last4: z.string().nullable(),
        }),
      }),
    set: (apiKey: string): Promise<{ ok: true; last4: string }> =>
      apiFetch(`/orgs/api-key`, {
        method: "PUT",
        body: { apiKey },
        schema: z.object({ ok: z.literal(true), last4: z.string() }),
      }),
  },
};
