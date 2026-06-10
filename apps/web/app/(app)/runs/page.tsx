import Link from "next/link";
import { LayoutList } from "lucide-react";
import { EmptyState } from "@/components/app/view-state";

export default function RunsPage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Every pipeline run for your organization shows up here, live.
      </p>
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
    </div>
  );
}
