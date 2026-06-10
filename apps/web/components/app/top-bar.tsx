"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { clearSessionToken, signOut, useSession } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { useConnectionStatus } from "@/lib/use-run-events";
import type { ConnectionStatus } from "./run-events-provider";

function titleFor(pathname: string): string {
  if (pathname.startsWith("/runs")) return "Runs";
  if (pathname.startsWith("/approvals")) return "Approvals";
  if (pathname.startsWith("/workflows")) return "Workflows";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Conductor";
}

const INDICATOR: Record<
  ConnectionStatus,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  connecting: { label: "connecting", dot: "bg-pending", text: "text-faint", pulse: false },
  live: { label: "live", dot: "bg-completed", text: "text-muted", pulse: true },
  reconnecting: { label: "reconnecting", dot: "bg-retrying", text: "text-retrying", pulse: true },
  offline: { label: "offline", dot: "bg-failed", text: "text-faint", pulse: false },
};

function ConnectionIndicator() {
  const status = useConnectionStatus();
  const s = INDICATOR[status];
  return (
    <span
      className={`hidden items-center gap-1.5 font-mono text-[0.7rem] sm:flex ${s.text}`}
      title={`Realtime connection: ${s.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "node-pulse" : ""}`} />
      {s.label}
    </span>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const email = session?.user.email ?? "";
  const initial = (session?.user.name ?? email ?? "?").slice(0, 1).toUpperCase();

  async function handleSignOut() {
    await signOut();
    clearSessionToken();
    clearApiJwt();
    router.replace("/login");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-full border border-line-soft bg-inset text-xs font-semibold text-ink transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-raised p-1 shadow-[var(--shadow-card)]">
            <div className="truncate px-2 py-2 text-xs text-muted">{email}</div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded border-t border-line-soft px-2 py-2 text-left text-sm text-ink transition-colors duration-150 hover:bg-surface"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line-soft bg-canvas/80 px-8 backdrop-blur-md">
      <h1 className="text-base font-semibold text-ink">{titleFor(pathname)}</h1>
      <div className="flex items-center gap-3">
        <ConnectionIndicator />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
