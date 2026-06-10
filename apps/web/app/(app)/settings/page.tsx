"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { authClient, organization } from "@/lib/auth-client";
import { Button, Card, Field, Input, Spinner } from "@/components/app/ui";
import { Skeleton, ErrorState } from "@/components/app/view-state";
import { useToast } from "@/components/app/toast";

/**
 * Org settings — the minimal Unit 23 slice (API key + members/invite), the
 * deep-link target for the onboarding checklist. Unit 27 completes it (roles,
 * removal, org profile, invitation accept flow). The key is owner-only
 * server-side and never displayed after entry (ui-context: masked,
 * replace-only).
 */

export const ORG_API_KEY_QUERY_KEY = ["org-api-key"] as const;

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof KeyRound;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-accent" />
      <div>
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}

function ApiKeyCard() {
  const client = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState("");

  const query = useQuery({
    queryKey: ORG_API_KEY_QUERY_KEY,
    queryFn: api.orgApiKey.get,
  });

  const save = useMutation({
    mutationFn: (apiKey: string) => api.orgApiKey.set(apiKey),
    onSuccess: () => {
      setValue("");
      toast("Saved");
      void client.invalidateQueries({ queryKey: ORG_API_KEY_QUERY_KEY });
    },
    onError: (err) => {
      toast(
        err instanceof ApiError && err.status === 403
          ? "Only an owner can change the API key."
          : "The key could not be saved. Try again.",
        "error",
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.trim().length >= 20) save.mutate(value.trim());
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        icon={KeyRound}
        title="OpenRouter API key"
        hint="Your pipelines run on your own key. Stored encrypted — never shown again after you save it. Owner only."
      />

      {query.status === "pending" && <Skeleton className="h-16 w-full" />}
      {query.status === "error" && (
        <ErrorState
          message="We couldn't load the key status."
          onRetry={() => void query.refetch()}
        />
      )}
      {query.status === "success" && (
        <>
          <p className="font-mono text-xs text-muted">
            {query.data.configured
              ? `Configured · ····${query.data.last4 ?? ""}`
              : "Not configured yet."}
          </p>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label={query.data.configured ? "Replace key" : "Add your key"}
                htmlFor="openrouter-key"
              >
                <Input
                  id="openrouter-key"
                  type="password"
                  placeholder="sk-or-…"
                  autoComplete="off"
                  minLength={20}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
            </div>
            <Button
              type="submit"
              size="md"
              disabled={save.isPending || value.trim().length < 20}
            >
              {save.isPending && <Spinner className="h-3.5 w-3.5" />}
              {query.data.configured ? "Replace key" : "Save key"}
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}

function MembersCard() {
  const { toast } = useToast();
  const { data: org, isPending, error, refetch } = authClient.useActiveOrganization();
  const [email, setEmail] = useState("");

  const invite = useMutation({
    mutationFn: (inviteeEmail: string) =>
      organization.inviteMember({ email: inviteeEmail, role: "member" }),
    onSuccess: (result) => {
      if (result.error) {
        toast(result.error.message ?? "The invitation could not be sent.", "error");
        return;
      }
      setEmail("");
      toast("Invited");
    },
    onError: () => toast("The invitation could not be sent.", "error"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) invite.mutate(email.trim());
  }

  const pendingInvites = org?.invitations?.filter((i) => i.status === "pending") ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        icon={Users}
        title="Members & approvers"
        hint="Anyone in your organization can approve runs. Invite the teammate who reviews your content."
      />

      {isPending && <Skeleton className="h-16 w-full" />}
      {!isPending && error && (
        <ErrorState
          message="We couldn't load your members."
          onRetry={() => void refetch()}
        />
      )}
      {!isPending && !error && org && (
        <>
          <ul className="flex flex-col gap-2">
            {org.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-md border border-line-soft bg-inset px-3 py-2"
              >
                <span className="text-sm text-ink">
                  {m.user.name || m.user.email}
                  <span className="ml-2 text-xs text-faint">{m.user.email}</span>
                </span>
                <span className="font-mono text-xs text-muted">{m.role}</span>
              </li>
            ))}
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-md border border-dashed border-line px-3 py-2"
              >
                <span className="text-sm text-muted">{i.email}</span>
                <span className="font-mono text-xs text-faint">invited</span>
              </li>
            ))}
          </ul>

          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Invite by email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="reviewer@agency.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <Button
              type="submit"
              variant="ghost"
              size="md"
              disabled={invite.isPending || !email.trim()}
            >
              {invite.isPending && <Spinner className="h-3.5 w-3.5" />}
              Invite
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Your organization&apos;s key and people. More settings arrive with the
        template library.
      </p>
      <ApiKeyCard />
      <MembersCard />
    </div>
  );
}
