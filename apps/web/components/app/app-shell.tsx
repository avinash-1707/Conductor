"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import { Spinner } from "./ui";
import { RunEventsProvider } from "./run-events-provider";
import { ToastProvider } from "./toast";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * Client-side guard + chrome for every authenticated page. Unauthenticated
 * users are sent to /login; signed-in users without an active org are sent to
 * /create-org (the API JWT carries the org, so there is nothing to scope to
 * without one).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!session.session.activeOrganizationId) {
      router.replace("/create-org");
    }
  }, [isPending, session, router]);

  if (isPending || !session || !session.session.activeOrganizationId) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <RunEventsProvider>
      <ToastProvider>
        <div className="min-h-screen bg-canvas">
          <Sidebar />
          <div className="flex min-h-screen flex-col md:pl-60">
            <TopBar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-6">
              {children}
            </main>
          </div>
        </div>
      </ToastProvider>
    </RunEventsProvider>
  );
}
