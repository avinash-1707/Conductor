"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, KeyRound, Link as LinkIcon, Users, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { authClient, organization, useSession } from "@/lib/auth-client";
import { Button, Card, Field, Input, Spinner } from "@/components/app/ui";
import { Skeleton, ErrorState } from "@/components/app/view-state";
import { useToast } from "@/components/app/toast";

/**
 * Org settings (completed in Unit 27): org profile, members with roles and
 * removal, invitations (delivered accept links + copyable link + revoke), and
 * the API key. Owner-only controls are visibly disabled for members — the
 * server enforces the same boundaries (requireOwner on the key; Better Auth's
 * org permissions on member/invitation/org mutations). The key is never
 * displayed after entry (ui-context: masked, replace-only).
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

/** A muted "owner only" marker next to controls a member cannot use. */
function OwnerOnly() {
  return <span className="text-xs text-faint">Owner only</span>;
}

function OrgProfileCard({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const { data: org, refetch } = authClient.useActiveOrganization();
  const [name, setName] = useState("");

  const rename = useMutation({
    mutationFn: (newName: string) => organization.update({ data: { name: newName } }),
    onSuccess: (result) => {
      if (result.error) {
        toast(result.error.message ?? "The name could not be changed.", "error");
        return;
      }
      setName("");
      toast("Saved");
      void refetch();
    },
    onError: () => toast("The name could not be changed.", "error"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) rename.mutate(name.trim());
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        icon={Building2}
        title="Organization"
        hint="The name your team sees everywhere in Conductor."
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Organization name" htmlFor="org-name">
            <Input
              id="org-name"
              placeholder={org?.name ?? ""}
              disabled={!isOwner}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          {!isOwner && <OwnerOnly />}
          <Button
            type="submit"
            variant="ghost"
            size="md"
            disabled={!isOwner || rename.isPending || !name.trim()}
          >
            {rename.isPending && <Spinner className="h-3.5 w-3.5" />}
            Rename
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ApiKeyCard({ isOwner }: { isOwner: boolean }) {
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
                  disabled={!isOwner}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              {!isOwner && <OwnerOnly />}
              <Button
                type="submit"
                size="md"
                disabled={!isOwner || save.isPending || value.trim().length < 20}
              >
                {save.isPending && <Spinner className="h-3.5 w-3.5" />}
                {query.data.configured ? "Replace key" : "Save key"}
              </Button>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}

function RoleChip({ role }: { role: string }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
        role === "owner"
          ? "border-accent/40 text-accent"
          : "border-line-soft text-muted"
      }`}
    >
      {role}
    </span>
  );
}

function MembersCard({ isOwner, selfId }: { isOwner: boolean; selfId: string }) {
  const { toast } = useToast();
  const { data: org, isPending, error, refetch } = authClient.useActiveOrganization();
  const [email, setEmail] = useState("");
  // Two-step inline confirm (ui-context destructive rule): the id of the
  // member/invitation whose action is awaiting confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);

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
      void refetch();
    },
    onError: () => toast("The invitation could not be sent.", "error"),
  });

  const remove = useMutation({
    mutationFn: (memberId: string) =>
      organization.removeMember({ memberIdOrEmail: memberId }),
    onSuccess: (result) => {
      if (result.error) {
        toast(result.error.message ?? "The member could not be removed.", "error");
        return;
      }
      toast("Removed");
      void refetch();
    },
    onError: () => toast("The member could not be removed.", "error"),
    onSettled: () => setConfirming(null),
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => organization.cancelInvitation({ invitationId }),
    onSuccess: (result) => {
      if (result.error) {
        toast(result.error.message ?? "The invitation could not be revoked.", "error");
        return;
      }
      toast("Revoked");
      void refetch();
    },
    onError: () => toast("The invitation could not be revoked.", "error"),
    onSettled: () => setConfirming(null),
  });

  function copyInviteLink(invitationId: string) {
    const url = `${window.location.origin}/accept-invitation/${invitationId}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast("Link copied"))
      .catch(() => toast("Couldn't copy — the link is in the invitation email.", "error"));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) invite.mutate(email.trim());
  }

  const pendingInvites = org?.invitations?.filter((i) => i.status === "pending") ?? [];
  const busy = remove.isPending || revoke.isPending;

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
                className="flex items-center justify-between gap-3 rounded-md border border-line-soft bg-inset px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {m.user.name || m.user.email}
                  <span className="ml-2 text-xs text-faint">{m.user.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <RoleChip role={m.role} />
                  {isOwner && m.userId !== selfId && (
                    confirming === m.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-failed">
                          They lose access to every run.
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-failed"
                          disabled={busy}
                          onClick={() => remove.mutate(m.id)}
                        >
                          {remove.isPending && <Spinner className="h-3 w-3" />}
                          Confirm remove
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted"
                        onClick={() => setConfirming(m.id)}
                        aria-label={`Remove ${m.user.email}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </span>
              </li>
            ))}
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{i.email}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-faint">invited</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted"
                    onClick={() => copyInviteLink(i.id)}
                    aria-label={`Copy invite link for ${i.email}`}
                  >
                    <LinkIcon className="h-3.5 w-3.5" />
                    Copy link
                  </Button>
                  {isOwner &&
                    (confirming === i.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-failed">The link stops working.</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-failed"
                          disabled={busy}
                          onClick={() => revoke.mutate(i.id)}
                        >
                          {revoke.isPending && <Spinner className="h-3 w-3" />}
                          Confirm revoke
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted"
                        onClick={() => setConfirming(i.id)}
                        aria-label={`Revoke invitation for ${i.email}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ))}
                </span>
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
                  disabled={!isOwner}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              {!isOwner && <OwnerOnly />}
              <Button
                type="submit"
                variant="ghost"
                size="md"
                disabled={!isOwner || invite.isPending || !email.trim()}
              >
                {invite.isPending && <Spinner className="h-3.5 w-3.5" />}
                Invite
              </Button>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();
  const selfId = session?.user.id ?? "";
  const isOwner =
    org?.members.some((m) => m.userId === selfId && m.role === "owner") ?? false;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Your organization&apos;s profile, people, and key.
      </p>
      <OrgProfileCard isOwner={isOwner} />
      <MembersCard isOwner={isOwner} selfId={selfId} />
      <ApiKeyCard isOwner={isOwner} />
    </div>
  );
}
