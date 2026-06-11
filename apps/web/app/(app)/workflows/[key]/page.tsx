"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitBranch, Rocket } from "lucide-react";
import {
  activityRegistry,
  templateCatalog,
  templateKeySchema,
} from "@conductor/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/app/ui";
import { ErrorState, Skeleton } from "@/components/app/view-state";
import { TemplateLaunchForm } from "@/components/app/template-launch-form";
import { SpecCanvas } from "@/components/canvas/spec-canvas";

/**
 * Template pipeline detail (Unit 30) — the curated spec rendered on the
 * read-only canvas, with the same generated launch form as the library. The
 * spec comes from the client's own catalog import; the templates query
 * contributes the org's pinned version number (and seeds it server-side).
 */

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-[320px] w-full rounded-xl lg:h-[380px]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line py-20 text-center">
      <p className="max-w-sm text-sm text-muted">
        We couldn&apos;t find that workflow template. It may have been renamed,
        or the link is wrong.
      </p>
      <Link
        href="/workflows"
        className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface/50 px-3 text-xs font-medium text-ink transition-colors hover:bg-raised"
      >
        Back to workflows
      </Link>
    </div>
  );
}

export default function TemplatePipelinePage() {
  const params = useParams<{ key: string }>();
  const parsedKey = templateKeySchema.safeParse(params.key);

  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: api.templates.list,
    enabled: parsedKey.success,
  });

  if (!parsedKey.success) return <NotFound />;
  const template = templateCatalog[parsedKey.data];

  if (templates.isPending) return <PageSkeleton />;
  if (templates.isError) {
    return (
      <ErrorState
        message="The workflow template couldn't be loaded."
        onRetry={() => void templates.refetch()}
      />
    );
  }

  const pinned = templates.data.items.find((item) => item.key === template.key);
  const gate = template.spec.nodes.find((node) => node.type === "approval");
  const gateHours =
    gate?.type === "approval"
      ? (gate.config.timeoutHours ?? activityRegistry.approval.defaults.timeoutHours)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-sm text-muted"
        aria-label="Breadcrumb"
      >
        <Link href="/workflows" className="transition-colors hover:text-ink">
          Workflows
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-faint" />
        <span className="text-ink">{template.name}</span>
        {pinned && (
          <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] text-faint">
            v{pinned.version}
          </span>
        )}
      </nav>

      <p className="max-w-2xl text-sm text-muted">{template.description}</p>

      <SpecCanvas spec={template.spec} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <Rocket className="h-4 w-4 text-accent" aria-hidden />
            Launch this pipeline
          </h2>
          <TemplateLaunchForm template={template} />
        </Card>

        <Card className="h-fit p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <GitBranch className="h-4 w-4 text-accent" aria-hidden />
            About this pipeline
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wide text-muted">Steps</dt>
              <dd className="font-mono text-sm text-ink">
                {template.spec.nodes.length}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wide text-muted">
                Approval window
              </dt>
              <dd className="font-mono text-sm text-ink">
                {gateHours !== null ? `${gateHours}h` : "—"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wide text-muted">
                Pinned version
              </dt>
              <dd className="font-mono text-sm text-ink">
                {pinned ? `v${pinned.version}` : "—"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wide text-muted">
                Parameters
              </dt>
              <dd className="font-mono text-sm text-ink">
                {template.fields.length}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-muted">
            Runs pin the version they start with — editing a template never
            changes a run already in flight.
          </p>
        </Card>
      </div>
    </div>
  );
}
