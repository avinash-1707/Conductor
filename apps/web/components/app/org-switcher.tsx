"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { authClient, organization, useSession } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";

export function OrgSwitcher() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: orgs } = authClient.useListOrganizations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeId = session?.session.activeOrganizationId ?? null;
  const list = orgs ?? [];
  const active = list.find((o) => o.id === activeId) ?? list[0] ?? null;

  async function select(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    await organization.setActive({ organizationId: id });
    // The active org rides in the JWT, so a stale token must be discarded.
    clearApiJwt();
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line-soft bg-inset/60 px-2.5 py-2 text-left transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-[var(--accent-fill)] text-[0.7rem] font-semibold text-[var(--accent-fg)]">
            {(active?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-medium text-ink">
            {active?.name ?? "No organization"}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-faint" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-line bg-raised p-1 shadow-[var(--shadow-card)]">
            {list.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => select(o.id)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-ink transition-colors duration-150 hover:bg-surface"
              >
                <span className="truncate">{o.name}</span>
                {o.id === activeId && <Check className="h-4 w-4 text-accent" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/create-org");
              }}
              className="mt-1 flex w-full items-center gap-2 rounded border-t border-line-soft px-2 py-1.5 text-left text-sm text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
            >
              <Plus className="h-4 w-4" />
              New organization
            </button>
          </div>
        </>
      )}
    </div>
  );
}
