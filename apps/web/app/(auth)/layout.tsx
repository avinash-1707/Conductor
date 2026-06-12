import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/landing/icons";
import { ThemeToggle } from "@/components/landing/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel: a finished run, on the record. Static on purpose —
          the form is the task here. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line-soft bg-inset p-10 lg:flex">
        <div aria-hidden className="dot-grid absolute inset-0" />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-[radial-gradient(circle,var(--glow-accent),transparent_70%)] blur-2xl"
        />

        <Link href="/" className="relative flex items-center gap-2 text-ink">
          <Logo className="h-5 w-5 text-accent" />
          <span className="font-mono text-sm font-medium tracking-tight">
            conductor
          </span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-display text-4xl leading-tight tracking-tight xl:text-5xl">
            Run AI workflows you can{" "}
            <em className="italic text-accent">trust</em>.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted">
            Pipelines that survive crashes, wait for human sign-off, and
            finish with every step on the record.
          </p>
        </div>

        <p className="relative flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-faint">
          <span>0 runs lost</span>
          <span>resumes from the exact step</span>
          <span>every attempt on the record</span>
        </p>
      </aside>

      {/* Form column */}
      <div className="relative flex flex-col">
        <header className="flex items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 text-ink lg:invisible">
            <Logo className="h-5 w-5 text-accent" />
            <span className="font-mono text-sm font-medium tracking-tight">
              conductor
            </span>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
