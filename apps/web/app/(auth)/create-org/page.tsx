"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { organization, signOut, useSession } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { Button, Card, Field, Input } from "@/components/app/ui";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "org"}-${suffix}`;
}

export default function CreateOrgPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.replace("/auth");
  }, [isPending, session, router]);

  // Creating an org is only for users who have none: anyone who already
  // belongs to one (a session predating the server-side default, or a direct
  // visit) is activated into their first org and sent home instead.
  useEffect(() => {
    if (isPending || !session || session.session.activeOrganizationId) return;
    let cancelled = false;
    void organization.list().then(async (orgs) => {
      const first = orgs.data?.[0];
      if (cancelled || !first) return;
      await organization.setActive({ organizationId: first.id });
      clearApiJwt();
      router.replace("/runs");
    });
    return () => {
      cancelled = true;
    };
  }, [isPending, session, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const created = await organization.create({ name, slug: slugify(name) });
    if (created.error || !created.data) {
      setBusy(false);
      setError(created.error?.message ?? "Could not create the organization.");
      return;
    }
    await organization.setActive({ organizationId: created.data.id });
    // The active org rides in the API JWT — drop the stale token.
    clearApiJwt();
    setBusy(false);
    router.replace("/runs");
  }

  return (
    <Card className="p-7">
      <h1 className="text-2xl tracking-tight text-ink">Name your organization</h1>
      <p className="mt-1 text-sm text-muted">
        This is the workspace your team runs pipelines in. You can rename it later.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field label="Organization name" htmlFor="org-name">
          <Input
            id="org-name"
            required
            autoFocus
            placeholder="Acme Content Studio"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {error && (
          <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy || !name.trim()} className="mt-1 w-full">
          {busy ? "Creating" : "Create organization"}
        </Button>
      </form>

      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.replace("/auth");
        }}
        className="mt-6 w-full text-center text-xs text-faint transition-colors hover:text-muted"
      >
        Sign out
      </button>
    </Card>
  );
}
