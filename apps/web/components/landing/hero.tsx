import { ArrowRight } from "./icons";
import { Button, Eyebrow } from "./primitives";
import { RunLedger } from "./run-ledger";

/**
 * Editorial hero: oversized Fraunces headline left, the live run ledger
 * right. Load motion is one orchestrated stagger (.rise with delays).
 */
export function Hero() {
  return (
    <section className="relative pt-36 md:pt-44">
      <div className="mx-auto max-w-6xl px-6">
        <div className="rise" style={{ animationDelay: "80ms" }}>
          <Eyebrow>AI operations · for content &amp; SEO agencies</Eyebrow>
        </div>
        <h1 className="mt-6 font-display text-[clamp(3.4rem,8.5vw,6.8rem)] leading-[0.98] tracking-[-0.02em]">
          <span className="rise block" style={{ animationDelay: "140ms" }}>
            Launch ten runs.
          </span>
          <span className="rise block" style={{ animationDelay: "260ms" }}>
            Go to <em className="italic text-accent">lunch</em>.
          </span>
        </h1>
        <div className="mt-4 grid items-end gap-14 lg:grid-cols-[1.12fr_0.88fr]">
          <div>
            <p
              className="rise mt-8 max-w-md text-base leading-relaxed text-muted"
              style={{ animationDelay: "380ms" }}
            >
              Conductor runs your AI content pipelines end to end — research,
              sign-off, writing, publish. Runs survive crashes, wait at human
              gates, and finish with every step on the record.
            </p>
            <div
              className="rise mt-10 flex flex-wrap items-center gap-4"
              style={{ animationDelay: "480ms" }}
            >
              <Button href="/signup">
                Start free
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Button>
              <Button href="#reliability" variant="ghost">
                Try to break it
              </Button>
            </div>
            <p
              className="rise mt-5 font-mono text-xs text-faint"
              style={{ animationDelay: "560ms" }}
            >
              free for design partners · no card · bring your own OpenRouter key
            </p>
          </div>

          <div className="rise" style={{ animationDelay: "420ms" }}>
            <RunLedger />
          </div>
        </div>

        <div className="mt-20 flex items-center justify-between border-t border-line-soft pt-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
          <span>conductor — run AI workflows you can trust</span>
          <span aria-hidden>scroll ↓</span>
        </div>
      </div>
    </section>
  );
}
