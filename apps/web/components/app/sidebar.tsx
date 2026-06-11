"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  LayoutList,
  MessageSquare,
  Settings,
  Users,
  Waypoints,
  Workflow,
  type LucideProps,
} from "lucide-react";
import { useCallback, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/landing/icons";
import {
  APPROVALS_QUERY_KEY,
  useApprovalsQuery,
  pendingCountLabel,
} from "@/lib/use-approvals";
import { useApprovalEvents } from "@/lib/use-run-events";
import { OrgSwitcher } from "./org-switcher";

type NavItem = { href: string; label: string; icon: ComponentType<LucideProps> };

const NAV: NavItem[] = [
  { href: "/runs", label: "Runs", icon: LayoutList },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/canvas", label: "Canvas", icon: Waypoints },
  { href: "/users", label: "Users", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const approvals = useApprovalsQuery();
  const badge = pendingCountLabel(approvals.data);

  // A new approval anywhere in the org refreshes the shared cache live — the
  // badge here and the open queue page read the same entry (Unit 23).
  const client = useQueryClient();
  useApprovalEvents(
    useCallback(
      () => void client.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY }),
      [client],
    ),
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line-soft bg-surface md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <Logo className="h-5 w-5 text-accent" />
        <span className="font-mono text-sm font-medium tracking-tight text-ink">
          conductor
        </span>
      </div>

      <div className="px-3 pb-2">
        <OrgSwitcher />
      </div>

      <nav className="flex-1 px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 ${
                    active
                      ? "bg-raised text-ink"
                      : "text-muted hover:bg-raised/60 hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.href === "/approvals" && badge && (
                    <span className="ml-auto rounded-full bg-suspended/15 px-1.5 py-0.5 font-mono text-[0.65rem] text-suspended">
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line-soft px-3 py-3">
        {/* Design-partner feedback channel (Unit 29) — feedback lives where
            the operator lives. Override with NEXT_PUBLIC_FEEDBACK_URL. */}
        <a
          href={
            process.env.NEXT_PUBLIC_FEEDBACK_URL ??
            "mailto:avinash@kakiyo.com?subject=Conductor%20feedback"
          }
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted transition-colors duration-150 hover:bg-raised/60 hover:text-ink"
        >
          <MessageSquare className="h-4 w-4" />
          Share feedback
        </a>
        <p className="px-2.5 pt-1 font-mono text-[0.65rem] text-faint">v1 · content ops</p>
      </div>
    </aside>
  );
}
