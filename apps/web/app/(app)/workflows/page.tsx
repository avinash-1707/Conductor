"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText } from "lucide-react";
import { templateCatalog, type TemplateResource } from "@conductor/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/app/ui";
import { EmptyState, ErrorState, Skeleton } from "@/components/app/view-state";
import { TemplateLaunchForm } from "@/components/app/template-launch-form";

/**
 * Workflow Library (Unit 26) — the spec-driven template list. The server call
 * pins (and seeds) each template's org definition version; display data and
 * the launch form come from the same shared catalog the server validates
 * against, so the form can never drift from the parameter contract.
 */

function TemplateCard({
  template,
  open,
  onToggle,
}: {
  template: TemplateResource;
  open: boolean;
  onToggle: () => void;
}) {
  const entry = templateCatalog[template.key];
  return (
    <Card className="p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 text-left"
      >
        <FileText className="mt-0.5 h-5 w-5 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink">{template.name}</h2>
            <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] text-faint">
              v{template.version}
            </span>
          </div>
          <p className="text-xs text-muted">{template.description}</p>
        </div>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <TemplateLaunchForm template={entry} />}
    </Card>
  );
}

function SkeletonCards() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <Card key={i} className="flex flex-col gap-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-full max-w-md" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ))}
    </div>
  );
}

export default function WorkflowsPage() {
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates.list });
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (templates.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted">Curated pipelines, ready to configure and run.</p>
        <SkeletonCards />
      </div>
    );
  }
  if (templates.isError) {
    return (
      <ErrorState
        message="The workflow library couldn't be loaded."
        onRetry={() => void templates.refetch()}
      />
    );
  }
  const items = templates.data.items;
  if (items.length === 0) {
    // Defensive — the curated catalog always ships at least one template.
    return (
      <EmptyState
        icon={FileText}
        message="No templates available yet."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Curated pipelines, ready to configure and run. Pick a template to set
        its parameters and launch.
      </p>
      <div className="flex flex-col gap-4">
        {items.map((template, index) => (
          <TemplateCard
            key={template.key}
            template={template}
            open={openKey ? openKey === template.key : index === 0}
            onToggle={() =>
              setOpenKey((prev) => (prev === template.key ? "" : template.key))
            }
          />
        ))}
      </div>
    </div>
  );
}
