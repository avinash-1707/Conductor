"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Logo } from "./icons";
import { Button } from "./primitives";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#reliability", label: "Reliability" },
];

// Read scroll position through an external store so there is no setState-in-effect
// and the value stays correct across re-renders.
function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

export function SiteNav() {
  const scrolled = useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 12,
    () => false,
  );

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4">
      <div
        className={`nav-enter flex h-14 w-full items-center justify-between transition-[max-width,margin-top,padding,border-radius,background-color,border-color,box-shadow] duration-[520ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          scrolled
            ? "mt-5 max-w-3xl rounded-full border border-line-soft bg-canvas/70 px-3 pl-5 shadow-[var(--shadow-card)] backdrop-blur-xl"
            : "mt-4 max-w-6xl rounded-none border border-transparent bg-transparent px-6"
        }`}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 text-ink transition-opacity hover:opacity-80"
        >
          <Logo className="h-5 w-5 text-accent" />
          <span className="font-mono text-sm font-medium tracking-tight">
            conductor
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors duration-200 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-sm text-muted transition-colors duration-200 hover:text-ink sm:block"
          >
            Sign in
          </Link>
          <Button href="/signup" size="sm">
            Start free
          </Button>
        </div>
      </div>
    </header>
  );
}
