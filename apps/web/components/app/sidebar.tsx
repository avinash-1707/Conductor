"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  LayoutList,
  Settings,
  Workflow,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";
import { Logo } from "@/components/landing/icons";
import { OrgSwitcher } from "./org-switcher";

type NavItem = { href: string; label: string; icon: ComponentType<LucideProps> };

const NAV: NavItem[] = [
  { href: "/runs", label: "Runs", icon: LayoutList },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

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
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line-soft px-4 py-3 font-mono text-[0.65rem] text-faint">
        v1 · content ops
      </div>
    </aside>
  );
}
