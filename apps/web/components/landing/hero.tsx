import { ArrowRight } from "./icons";
import { Button } from "./primitives";
import { CyberGrid } from "./cyber-grid";
import { RunLedger } from "./run-ledger";

/**
 * Editorial hero over the animated grid backdrop: oversized Fraunces
 * headline, one line of copy, two actions, and the live run ledger. Load
 * motion is one orchestrated stagger (.rise with delays).
 */
export function Hero() {
  return (
    <section className="relative flex min-h-svh flex-col justify-center overflow-hidden pb-44 pt-28 md:pt-24">
      <CyberGrid />
      <div className="relative mx-auto w-full max-w-6xl px-6">
        <h1 className="font-display text-[clamp(3.4rem,8.5vw,6.8rem)] leading-[0.98] tracking-[-0.02em]">
          <span className="rise block" style={{ animationDelay: "120ms" }}>
            Launch ten runs.
          </span>
          <span className="rise block" style={{ animationDelay: "240ms" }}>
            Go to <em className="italic text-accent">lunch</em>.
          </span>
        </h1>
        <div className="mt-8 grid items-end gap-14 lg:grid-cols-[1.12fr_0.88fr]">
          <div>
            <p
              className="rise max-w-md text-base leading-relaxed text-muted"
              style={{ animationDelay: "360ms" }}
            >
              Conductor runs your AI content pipelines end to end. Runs survive
              crashes, wait for human sign-off, and finish on the record.
            </p>
            <div
              className="rise mt-8 flex flex-wrap items-center gap-4"
              style={{ animationDelay: "460ms" }}
            >
              <Button href="/signup">
                Start free
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Button>
              <Button href="#reliability" variant="ghost">
                Try to break it
              </Button>
            </div>
          </div>

          <div className="rise" style={{ animationDelay: "420ms" }}>
            <RunLedger />
          </div>
        </div>
      </div>
    </section>
  );
}
