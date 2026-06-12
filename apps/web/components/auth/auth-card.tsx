"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  loginFormSchema,
  signupFormSchema,
  type LoginFormValues,
  type SignupFormValues,
} from "@conductor/shared";
import { signIn, signUp } from "@/lib/auth-client";
import { clearApiJwt } from "@/lib/jwt";
import { safeNextPath } from "@/lib/next-param";
import { Button, Card, Field, Input, Spinner } from "@/components/app/ui";

type Mode = "login" | "signup";

/** Password input with a show/hide toggle (ref-friendly for RHF register). */
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="text-failed">{message}</span>;
}

/** Heuristic strength score: 1 (weak) to 4 (strong); 0 for empty. */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  if (pw.length < 8) return 1;
  let score = 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(4, score);
}

const STRENGTH: Record<number, { label: string; tone: string; bar: string }> = {
  1: { label: "weak", tone: "text-failed", bar: "bg-failed" },
  2: { label: "fair", tone: "text-retrying", bar: "bg-retrying" },
  3: { label: "good", tone: "text-suspended", bar: "bg-suspended" },
  4: { label: "strong", tone: "text-completed", bar: "bg-completed" },
};

function StrengthMeter({ password }: { password: string }) {
  const score = scorePassword(password);
  if (score === 0) return null;
  const { label, tone, bar } = STRENGTH[score]!;
  return (
    <span className="flex items-center gap-2.5" aria-live="polite">
      <span className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={`h-1 flex-1 rounded-md transition-colors duration-300 ${
              segment <= score ? bar : "bg-line"
            }`}
          />
        ))}
      </span>
      <span
        className={`font-mono text-[0.65rem] uppercase tracking-[0.14em] ${tone}`}
      >
        {label}
      </span>
    </span>
  );
}

function ServerError({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message && (
        <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
          {message}
        </p>
      )}
    </div>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={busy} className="mt-1 w-full">
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </Button>
  );
}

function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const { error } = await signIn.email(values);
    if (error) {
      setServerError(error.message ?? "Could not sign in. Check your details.");
      return;
    }
    clearApiJwt();
    router.replace(next ?? "/runs");
  });

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
      <Field
        label="Email"
        htmlFor="email"
        hint={<FieldError message={errors.email?.message} />}
      >
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          {...register("email")}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint={<FieldError message={errors.password?.message} />}
      >
        <PasswordInput
          id="password"
          autoComplete="current-password"
          {...register("password")}
        />
      </Field>
      <ServerError message={serverError} />
      <SubmitButton busy={isSubmitting}>
        {isSubmitting ? "Signing in" : "Sign in"}
      </SubmitButton>
    </form>
  );
}

function SignupForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      agree: false,
    },
  });
  const password = watch("password");

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setServerError(null);
    const { error } = await signUp.email({ name, email, password });
    if (error) {
      setServerError(error.message ?? "Could not create your account.");
      return;
    }
    clearApiJwt();
    // No org yet — the next step names the organization, unless an
    // invitation link brought them here.
    router.replace(next ?? "/create-org");
  });

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
      <Field
        label="Name"
        htmlFor="name"
        hint={<FieldError message={errors.name?.message} />}
      >
        <Input id="name" autoComplete="name" autoFocus {...register("name")} />
      </Field>
      <Field
        label="Email"
        htmlFor="email"
        hint={<FieldError message={errors.email?.message} />}
      >
        <Input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email")}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint={
          errors.password?.message ? (
            <FieldError message={errors.password.message} />
          ) : password ? (
            <StrengthMeter password={password} />
          ) : (
            "At least 8 characters."
          )
        }
      >
        <PasswordInput
          id="password"
          autoComplete="new-password"
          {...register("password")}
        />
      </Field>
      <Field
        label="Confirm password"
        htmlFor="confirm-password"
        hint={<FieldError message={errors.confirmPassword?.message} />}
      >
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2.5 text-xs leading-5 text-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
            style={{ accentColor: "var(--accent-fill)" }}
            {...register("agree")}
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
        {errors.agree?.message && (
          <p className="text-xs">
            <FieldError message={errors.agree.message} />
          </p>
        )}
      </div>
      <ServerError message={serverError} />
      <SubmitButton busy={isSubmitting}>
        {isSubmitting ? "Creating account" : "Create account"}
      </SubmitButton>
    </form>
  );
}

/**
 * The single auth surface at /auth. Mode comes from the `mode` query param
 * (default login) and lives in state after that; the bottom link switches it
 * in place, keeping the URL truthful via history.replaceState. The `next`
 * param (internal-only) survives switching — an invitee arriving from an
 * accept link must never be routed into creating their own org. Validation
 * is react-hook-form over the shared zod schemas (login/signupFormSchema).
 */
export function AuthCard() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "signup" ? "signup" : "login",
  );
  const login = mode === "login";

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    const params = new URLSearchParams();
    if (nextMode === "signup") params.set("mode", "signup");
    if (next) params.set("next", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/auth?${qs}` : "/auth");
  }

  return (
    <Card className="relative overflow-hidden p-7">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-primary)_55%,transparent),transparent)]"
      />
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-faint">
        operations console
      </p>
      {/* Re-mounting on mode switch gives the form one quick enter and a
          fresh RHF state. */}
      <div key={mode} className="modal-enter">
        <h1 className="mt-3 text-2xl tracking-tight text-ink">
          {login ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {login
            ? "Sign in to your operations console."
            : "Run AI pipelines you can trust. Free for design partners."}
        </p>
        {login ? <LoginForm next={next} /> : <SignupForm next={next} />}
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
