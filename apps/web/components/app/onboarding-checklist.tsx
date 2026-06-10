"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Button, Card } from "@/components/app/ui";

/**
 * First-run onboarding (ui-context): a guided checklist, not a tour. State is
 * derived, never stored — org (the create-org gate precedes this page), key
 * (`GET /orgs/api-key`), invite (members/invitations on the active org, or a
 * per-org localStorage skip), first run (the dashboard's own runs data). The
 * card renders nothing while loading and disappears once everything is done —
 * the dashboard belongs to the runs.
 */

const SKIP_KEY_PREFIX = "conductor.onboarding.invite-skipped.";

function readInviteSkipped(orgId: string): boolean {
  try {
    return localStorage.getItem(`${SKIP_KEY_PREFIX}${orgId}`) === "1";
  } catch {
    return false;
  }
}

interface ChecklistItem {
  label: string;
  done: boolean;
  href?: string;
  skippable?: boolean;
  skipped?: boolean;
}

function ItemRow({
  item,
  onSkip,
}: {
  item: ChecklistItem;
  onSkip?: () => void;
}) {
  const icon = item.done ? (
    <CheckCircle2 className="h-4 w-4 shrink-0 text-completed" />
  ) : (
    <Circle className="h-4 w-4 shrink-0 text-faint" />
  );
  const label = (
    <span className={`text-sm ${item.done ? "text-muted line-through decoration-line" : "text-ink"}`}>
      {item.label}
      {item.skipped && <span className="ml-2 text-xs text-faint">Skipped</span>}
    </span>
  );

  return (
    <li className="flex items-center gap-3 py-1.5">
      {icon}
      {!item.done && item.href ? (
        <Link
          href={item.href}
          className="group flex flex-1 items-center justify-between gap-2 rounded-md transition-colors hover:text-accent"
        >
          {label}
          <ArrowRight className="h-4 w-4 text-faint transition-colors group-hover:text-accent" />
        </Link>
      ) : (
        <span className="flex-1">{label}</span>
      )}
      {!item.done && item.skippable && onSkip && (
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip
        </Button>
      )}
    </li>
  );
}

export function OnboardingChecklist({ hasRuns }: { hasRuns: boolean }) {
  const { data: org, isPending: orgPending } = authClient.useActiveOrganization();
  const keyQuery = useQuery({
    queryKey: ["org-api-key"],
    queryFn: api.orgApiKey.get,
  });
  // Lazy-read once per org; the setter writes through to localStorage.
  const [skippedFor, setSkippedFor] = useState<string | null>(null);

  // Supplementary surface: render nothing until everything needed is known
  // (the runs table beneath owns the page's loading/error states).
  if (orgPending || !org || keyQuery.status !== "success") return null;

  const inviteSkipped = skippedFor === org.id || readInviteSkipped(org.id);
  const invited =
    org.members.length > 1 ||
    org.invitations.some((i) => i.status === "pending");

  const items: ChecklistItem[] = [
    { label: "Name your organization", done: true },
    {
      label: "Add your OpenRouter API key",
      done: keyQuery.data.configured,
      href: "/settings",
    },
    {
      label: "Invite an approver",
      done: invited || inviteSkipped,
      skipped: !invited && inviteSkipped,
      href: "/settings",
      skippable: true,
    },
    { label: "Run your first pipeline", done: hasRuns, href: "/workflows" },
  ];

  if (items.every((i) => i.done)) return null;

  const doneCount = items.filter((i) => i.done).length;

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">Get set up</h2>
        <span className="font-mono text-xs text-faint">
          {doneCount}/{items.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        Your first live run is minutes away.
      </p>
      <ul className="mt-3 flex flex-col">
        {items.map((item) => (
          <ItemRow
            key={item.label}
            item={item}
            onSkip={
              item.skippable
                ? () => {
                    try {
                      localStorage.setItem(`${SKIP_KEY_PREFIX}${org.id}`, "1");
                    } catch {
                      /* storage unavailable; skip lasts the tab */
                    }
                    setSkippedFor(org.id);
                  }
                : undefined
            }
          />
        ))}
      </ul>
    </Card>
  );
}
