"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { safeNextPath } from "@/lib/next-param";
import { Button, Card, Field, Input } from "@/components/app/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to land after auth (e.g. an invitation accept link) — internal only.
  const next = safeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Could not sign in. Check your details.");
      return;
    }
    clearApiJwt();
    router.replace(next ?? "/runs");
  }

  return (
    <Card className="p-7">
      <h1 className="text-2xl tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to your operations console.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
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
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
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
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to Conductor?{" "}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="text-accent hover:underline"
        >
          Create an account
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary (same pattern as /approvals).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
