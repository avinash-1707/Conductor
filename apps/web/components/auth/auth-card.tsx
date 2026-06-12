"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { safeNextPath } from "@/lib/next-param";
import { Button, Card, Field, Input, Spinner } from "@/components/app/ui";

type Mode = "login" | "signup";

/** Password input with a show/hide toggle. */
function PasswordInput({
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className="pr-11"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * One auth surface for both sign-in and sign-up. The mode lives in state and
 * the bottom link switches it in place; the URL is kept truthful with
 * history.replaceState so refresh and back behave as expected. The `next`
 * param (internal-only) survives switching — an invitee arriving from an
 * accept link must never be routed into creating their own org.
 */
export function AuthCard({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = mode === "login";
  const mismatch = !login && confirm.length > 0 && confirm !== password;

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirm("");
    const path = nextMode === "login" ? "/login" : "/signup";
    const qs = next ? `?next=${encodeURIComponent(next)}` : "";
    window.history.replaceState(null, "", `${path}${qs}`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!login && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error } = login
      ? await signIn.email({ email, password })
      : await signUp.email({ name, email, password });
    setBusy(false);
    if (error) {
      setError(
        error.message ??
          (login
            ? "Could not sign in. Check your details."
            : "Could not create your account."),
      );
      return;
    }
    clearApiJwt();
    // After sign-up the next step names the organization, unless an
    // invitation link brought them here.
    router.replace(next ?? (login ? "/runs" : "/create-org"));
  }

  return (
    <Card className="p-7">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-faint">
        operations console
      </p>
      {/* Re-mounting on mode switch gives the form one quick enter. */}
      <div key={mode} className="modal-enter">
        <h1 className="mt-3 text-2xl tracking-tight text-ink">
          {login ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {login
            ? "Sign in to your operations console."
            : "Run AI pipelines you can trust. Free for design partners."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {!login && (
            <Field label="Name" htmlFor="name">
              <Input
                id="name"
                autoComplete="name"
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus={login}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint={login ? undefined : "At least 8 characters."}
          >
            <PasswordInput
              id="password"
              autoComplete={login ? "current-password" : "new-password"}
              minLength={login ? undefined : 8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!login && (
            <Field
              label="Confirm password"
              htmlFor="confirm-password"
              hint={
                mismatch ? (
                  <span className="text-failed">Passwords do not match.</span>
                ) : undefined
              }
            >
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
          {!login && (
            <label className="flex items-start gap-2.5 text-xs leading-5 text-muted">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
                style={{ accentColor: "var(--accent-fill)" }}
              />
              <span>
                I agree to the{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-accent hover:underline"
                >
                  privacy policy
                </Link>
                .
              </span>
            </label>
          )}

          <div aria-live="polite">
            {error && (
              <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
                {error}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={busy || mismatch}
            className="mt-1 w-full"
          >
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {login
              ? busy
                ? "Signing in"
                : "Sign in"
              : busy
                ? "Creating account"
                : "Create account"}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {login ? "New to Conductor? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => switchMode(login ? "signup" : "login")}
          className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {login ? "Create an account" : "Sign in"}
        </button>
      </p>
    </Card>
  );
}
