"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { organization, useSession } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { Button, Card, Spinner } from "@/components/app/ui";

/**
 * The invitation accept link (Unit 27) — the canonical URL the invitation
 * email carries. Unauthenticated visitors detour through /login (the `next`
 * param brings them back); authenticated ones accept, switch their active org
 * to the new one (clearing the cached org-carrying API JWT, same rule as the
 * org switcher), and land on the dashboard.
 */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const invitationId = params.id;
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace(
        `/login?next=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`,
      );
      return;
    }
    if (started.current) return;
    started.current = true;

    void (async () => {
      const accepted = await organization.acceptInvitation({ invitationId });
      if (accepted.error || !accepted.data) {
        // The login-time auto-accept usually consumed this invitation already
        // (a fresh sign-up through the link, or a re-clicked email link) —
        // Better Auth then reports it "not found". The session is the
        // arbiter: if the user is in an org, the join already happened, so
        // this is success, not an error.
        if (session.session.activeOrganizationId) {
          clearApiJwt();
          router.replace("/runs");
          return;
        }
        // Expired, revoked, already used by someone else, or addressed to a
        // different email.
        setError(
          "This invitation can't be accepted. It may have expired or been sent to a different email address.",
        );
        return;
      }
      await organization.setActive({
        organizationId: accepted.data.invitation.organizationId,
      });
      // The API JWT carries the active org — force a fresh one.
      clearApiJwt();
      router.replace("/runs");
    })();
  }, [isPending, session, invitationId, router]);

  return (
    <Card className="flex flex-col items-center gap-4 p-7 text-center">
      {error ? (
        <>
          <h1 className="text-lg tracking-tight text-ink">Invitation not available</h1>
          <p className="text-sm text-muted">{error}</p>
          <Button onClick={() => router.replace("/runs")} size="sm">
            Go to your dashboard
          </Button>
          <p className="text-xs text-muted">
            Signed in with the wrong account?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Switch account
            </Link>
          </p>
        </>
      ) : (
        <>
          <Spinner className="h-5 w-5" />
          <h1 className="text-lg tracking-tight text-ink">Joining organization…</h1>
          <p className="text-sm text-muted">
            Accepting your invitation and setting up your workspace.
          </p>
        </>
      )}
    </Card>
  );
}
