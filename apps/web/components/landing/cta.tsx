import { ArrowRight } from "./icons";
import { Button } from "./primitives";
import { CyberGrid } from "./cyber-grid";
import { Reveal } from "./reveal";

export function CallToAction() {
  return (
    <section className="relative overflow-hidden py-32 md:py-44">
      {/* Reprise of the hero backdrop: the page closes where it opened. */}
      <CyberGrid beamCount={12} />
      <div className="relative mx-auto max-w-6xl px-6 text-center">
        <Reveal>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.24em] text-faint">
            § 05 · the ask
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mx-auto mt-8 max-w-4xl font-display text-[clamp(2.6rem,6vw,4.8rem)] leading-[1.05] tracking-tight">
            Run AI workflows you can{" "}
            <em className="italic text-accent">trust</em>.
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted">
            We&apos;re onboarding three design-partner agencies, free, in
            exchange for honest feedback every week. Your pipelines, running
            unattended by Friday.
          </p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button href="/signup">
              Start free
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Button>
            <Button href="/login" variant="ghost">
              Open the console
            </Button>
          </div>
        </Reveal>
        <Reveal delay={320}>
          <p className="mt-6 font-mono text-xs text-faint">
            setup ≈ one afternoon · bring your OpenRouter key · kill our worker
            any time
          </p>
        </Reveal>
      </div>
    </section>
  );
}
