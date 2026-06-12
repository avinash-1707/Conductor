"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./primitives";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#run", label: "The run" },
  { href: "#reliability", label: "Reliability" },
  { href: "#features", label: "Spec" },
];

/**
 * Fixed nav that slides in on load, then morphs from a full-width bar into a
 * floating capsule once the page scrolls (transition lives in .nav-shell).
 */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="nav-enter fixed inset-x-0 top-0 z-50 px-4">
      <nav
        aria-label="Main"
        className={`nav-shell mx-auto flex h-14 items-center justify-between border backdrop-blur-md ${
          scrolled
            ? "mt-6 max-w-4xl rounded-xl border-line-soft bg-[color-mix(in_oklab,var(--bg-surface)_84%,transparent)] px-4 shadow-[var(--shadow-card)]"
            : "mt-4 max-w-6xl rounded-none border-transparent bg-transparent px-2"
        }`}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Logo className="h-5 w-5 text-accent" />
          <span className="text-sm font-semibold tracking-tight">Conductor</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="link-underline font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted transition-colors duration-200 hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <Button href="/auth" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </Button>
          <Button href="/auth?mode=signup" size="sm">
            Start free
          </Button>
        </div>
      </nav>
    </header>
  );
}
