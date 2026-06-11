"use client";

import Link from "next/link";
import { ArrowUpRight, Users as UsersIcon } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { Card } from "@/components/app/ui";
import { Skeleton, ErrorState, EmptyState } from "@/components/app/view-state";
import { RoleChip } from "@/components/app/role-chip";
import { relativeTime } from "@/lib/format";

/**
 * Users — the org roster, read-only (management lives in Settings). Owners
 * sort first, then by join date; pending invitations trail as ghost rows so
 * the page answers "who can act in this org, and who is on the way in" at a
 * glance. Identity is rendered in the console voice: initial tiles, mono
 * emails, the shared RoleChip, relative join times.
 */

function initialOf(name: string, email: string): string {
  const source = name.trim() || email;
  return (source[0] ?? "?").toUpperCase();
}

type Member = {
  id: string;
  role: string;
  userId: string;
  createdAt: string | Date;
  user: { name: string; email: string; image?: string | null };
};

function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const joined = relativeTime(new Date(member.createdAt).toISOString());
  const isOwner = member.role === "owner";
  return (
    <li className="group flex items-center gap-3.5 px-4 py-3 transition-colors duration-150 hover:bg-raised/60">
      <span
        aria-hidden
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-inset font-mono text-sm text-ink ${
          isOwner ? "border-accent/40" : "border-line-soft"
        }`}
      >
        {initialOf(member.user.name, member.user.email)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {member.user.name || member.user.email}
          </span>
          {isSelf && (
            <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
              you
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-xs text-faint">
          {member.user.email}
        </span>
      </span>

      <RoleChip role={member.role} />
      <span
        className="hidden w-28 text-right font-mono text-xs text-faint sm:block"
        title="Joined"
      >
        {joined}
      </span>
    </li>
  );
}

function RosterSkeleton() {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line-soft">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="flex items-center gap-3.5 px-4 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-1.5 h-3 w-56" />
            </div>
            <Skeleton className="h-4 w-12" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function UsersPage() {
  const { data: session } = useSession();
  const { data: org, isPending, error, refetch } = authClient.useActiveOrganization();
  const selfId = session?.user.id ?? "";

  const members = [...(org?.members ?? [])].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const pendingInvites = org?.invitations?.filter((i) => i.status === "pending") ?? [];
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const summary = [
    `${members.length} ${members.length === 1 ? "person" : "people"}`,
    `${ownerCount} ${ownerCount === 1 ? "owner" : "owners"}`,
    ...(pendingInvites.length > 0 ? [`${pendingInvites.length} invited`] : []),
  ].join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted">
            Everyone in this organization can start runs and approve them.
          </p>
          {!isPending && !error && org && (
            <p className="mt-1 font-mono text-xs text-faint">{summary}</p>
          )}
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-accent transition-colors hover:text-accent-hi"
        >
          Manage in Settings
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      {isPending && <RosterSkeleton />}

      {!isPending && error && (
        <ErrorState
          message="We couldn't load your organization's users."
          onRetry={() => void refetch()}
        />
      )}

      {!isPending && !error && org && members.length === 0 && (
        <EmptyState
          icon={UsersIcon}
          message="No users yet. Invite your team from Settings."
          action={
            <Link href="/settings" className="text-sm text-accent hover:text-accent-hi">
              Invite a teammate
            </Link>
          }
        />
      )}

      {!isPending && !error && org && members.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line-soft">
            {members.map((m) => (
              <MemberRow key={m.id} member={m} isSelf={m.userId === selfId} />
            ))}
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3.5 border-t border-dashed border-line px-4 py-3"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-line bg-inset font-mono text-sm text-faint"
                >
                  {(i.email[0] ?? "?").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-muted">
                    {i.email}
                  </span>
                  <span className="block text-xs text-faint">
                    Invitation sent — they appear here once they accept.
                  </span>
                </span>
                <span className="font-mono text-xs text-faint">invited</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
