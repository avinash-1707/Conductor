import { ArrowRight } from "./icons";
import { Button, Eyebrow } from "./primitives";
import { Reveal } from "./reveal";
import { RunTimeline } from "./run-timeline";

export function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-36 sm:pt-44">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        {/* copy */}
        <div className="max-w-xl">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface/60 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-completed" />
              <Eyebrow>AI operations, on autopilot</Eyebrow>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-6 text-balance text-5xl leading-[1.04] tracking-tight text-ink sm:text-6xl">
              Run AI pipelines
              <br />
              you can{" "}
              <span className="italic text-accent">actually</span> trust.
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-6 max-w-md text-pretty text-base leading-relaxed text-muted">
              Conductor runs your content and SEO pipelines from brief to
              published. They survive crashes, pause for a human when it
              matters, and finish without anyone watching.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button href="/signup">
                Start free
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Button>
              <Button href="#reliability" variant="ghost">
                Watch a run recover
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <p className="mt-8 font-mono text-xs text-faint">
              No lost runs. No blind spots. No babysitting.
            </p>
          </Reveal>
        </div>

        {/* the live demo */}
        <Reveal delay={220} className="lg:pl-4">
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(circle_at_50%_30%,var(--glow-accent),transparent_70%)] blur-2xl"
            />
            <RunTimeline />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
