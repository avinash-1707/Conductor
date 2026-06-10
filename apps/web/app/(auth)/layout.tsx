import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/landing/icons";
import { ThemeToggle } from "@/components/landing/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10">
      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Logo className="h-5 w-5 text-accent" />
          <span className="font-mono text-sm font-medium tracking-tight">
            conductor
          </span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
