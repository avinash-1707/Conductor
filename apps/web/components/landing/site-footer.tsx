import Link from "next/link";
import { Logo } from "./icons";

const GROUPS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Features", href: "#features" },
      { label: "Reliability", href: "#reliability" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Careers", href: "/careers" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Start free", href: "/signup" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 text-ink">
              <Logo className="h-5 w-5 text-accent" />
              <span className="font-mono text-sm font-medium">conductor</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Run the AI work you cannot afford to lose.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.heading}>
              <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-faint">
                {group.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted transition-colors duration-200 hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-line-soft pt-6 font-mono text-xs text-faint sm:flex-row sm:items-center">
          <span>© 2026 Conductor</span>
          <span>Run AI workflows you can trust.</span>
        </div>
      </div>
    </footer>
  );
}
