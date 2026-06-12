import { ArrowRight } from "./icons";
import { Folio } from "./primitives";
import { Reveal } from "./reveal";

const FEATURES = [
  {
    n: "01",
    name: "Durable execution",
    tag: "durable",
    text: "A crashed worker doesn't kill a run. Work resumes from the exact step, every time, without a human noticing.",
  },
  {
    n: "02",
    name: "Human approval gates",
    tag: "human-gate",
    text: "Runs pause for sign-off and resume within seconds of a click. No polling, no Slack archaeology.",
  },
  {
    n: "03",
    name: "Live operations dashboard",
    tag: "live",
    text: "Every run, every step, streaming over WebSocket. “Is everything okay?” answered in one glance.",
  },
  {
    n: "04",
    name: "Replayable audit trail",
    tag: "replayable",
    text: "Every input, output, retry and decision: who approved what, when. Immutable, org-scoped, exportable.",
  },
  {
    n: "05",
    name: "Resume from step",
    tag: "resume",
    text: "A failed run continues from its last good step. Finished work is never redone, tokens never re-spent.",
  },
  {
    n: "06",
    name: "Templates & visual canvas",
    tag: "two-surfaces",
    text: "Operators launch from configurable templates; designers draw pipelines on a canvas. One engine runs both.",
  },
  {
    n: "07",
    name: "Isolation & your own keys",
    tag: "isolated",
    text: "Every row is org-scoped from the first migration. Your OpenRouter key, encrypted, spent only on your runs.",
  },
];

/** §04 — the spec sheet: features as ruled editorial index rows, not cards. */
export function FeatureIndex() {
  return (
    <section id="features" className="scroll-mt-24 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <Folio n="04" title="The spec sheet" />
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-10 max-w-3xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            Everything an operations layer{" "}
            <em className="italic text-accent">owes</em> you.
          </h2>
        </Reveal>

        <div className="mt-14">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.n} delay={60 + i * 50}>
              <div className="group grid grid-cols-[3rem_1fr_auto] items-baseline gap-x-6 border-t border-line-soft py-6 transition-colors duration-200 hover:bg-surface/60 md:grid-cols-[4rem_18rem_1fr_auto] md:gap-x-10 md:px-4">
                <span className="font-mono text-sm tabular-nums text-faint">
                  {feature.n}
                </span>
                <h3 className="font-display text-xl tracking-tight md:text-2xl">
                  {feature.name}
                </h3>
                <p className="col-span-2 col-start-2 mt-2 max-w-xl text-sm leading-relaxed text-muted md:col-span-1 md:col-start-3 md:mt-0">
                  {feature.text}
                </p>
                <span className="hidden items-center gap-3 md:flex">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-faint">
                    {feature.tag}
                  </span>
                  <ArrowRight className="h-4 w-4 text-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent" />
                </span>
              </div>
            </Reveal>
          ))}
          <div className="border-t border-line-soft" />
        </div>
      </div>
    </section>
  );
}
