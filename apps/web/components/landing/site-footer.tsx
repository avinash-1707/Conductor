import Link from "next/link";
import { Logo } from "./icons";

export function SiteFooter() {
  return (
    <footer className="overflow-hidden">
      <div className="border-t border-line-soft">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-6 font-mono text-xs text-faint">
          <span className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-accent" />© 2026 Conductor · built
            to be killed mid-run.
          </span>
          <span className="flex items-center gap-6">
            <Link
              href="/login"
              className="link-underline transition-colors duration-200 hover:text-ink"
            >
              sign in
            </Link>
            <Link
              href="/signup"
              className="link-underline transition-colors duration-200 hover:text-ink"
            >
              start free
            </Link>
            <a
              href="#top"
              className="link-underline transition-colors duration-200 hover:text-ink"
            >
              top ↑
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
