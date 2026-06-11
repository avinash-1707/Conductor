"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { signUp } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { safeNextPath } from "@/lib/next-param";
import { Button, Card, Field, Input } from "@/components/app/ui";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // An invitee arriving from an accept link must not be routed into creating
  // their own org — `next` (internal-only) wins over the create-org default.
  const next = safeNextPath(searchParams.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signUp.email({ name, email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Could not create your account.");
      return;
    }
    clearApiJwt();
    // No org yet — the next step names the organization (unless an
    // invitation link brought them here).
    router.replace(next ?? "/create-org");
  }

  return (
    <Card className="p-7">
      <h1 className="text-2xl tracking-tight text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-muted">
        Run AI pipelines you can trust. Free for design partners.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field label="Name" htmlFor="name">
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="mt-1 w-full">
          {busy ? "Creating account" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-accent hover:underline"
        >
          Sign in
        </Link>
      </p>
    </Card>
  );
}

export default function SignupPage() {
  // useSearchParams requires a Suspense boundary (same pattern as /approvals).
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
