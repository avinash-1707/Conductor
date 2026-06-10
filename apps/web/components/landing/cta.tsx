import { ArrowRight } from "./icons";
import { Button } from "./primitives";
import { Reveal } from "./reveal";

export function CallToAction() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-line-soft bg-surface px-8 py-16 text-center shadow-[var(--shadow-card)] sm:px-16 sm:py-20">
          <div
            aria-hidden
            className="absolute inset-x-0 -top-24 -z-0 mx-auto h-48 w-[min(36rem,80%)] rounded-full bg-[radial-gradient(circle,var(--glow-accent),transparent_70%)] blur-2xl"
          />
          <div className="relative">
            <h2 className="mx-auto max-w-xl text-4xl leading-tight tracking-tight text-ink sm:text-5xl">
              Stop babysitting your pipelines.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-pretty text-muted">
              Set them running and get back to the work that actually needs you.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button href="/signup">
                Start free
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Button>
              <Button href="/contact" variant="ghost">
                Talk to us
              </Button>
            </div>
            <p className="mt-7 font-mono text-xs text-faint">
              Free for design partners. No card required.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
