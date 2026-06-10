import { Eyebrow } from "./primitives";
import { Reveal } from "./reveal";

type Step = {
  no: string;
  name: string;
  blurb: string;
  accent: string;
};

const STEPS: Step[] = [
  {
    no: "01",
    name: "research",
    blurb: "It pulls together sources and angles for your topic.",
    accent: "text-running",
  },
  {
    no: "02",
    name: "review",
    blurb: "It pauses so a teammate can approve before anything ships.",
    accent: "text-suspended",
  },
  {
    no: "03",
    name: "write",
    blurb: "It drafts to your tone, length, and keywords.",
    accent: "text-accent",
  },
  {
    no: "04",
    name: "publish",
    blurb: "It delivers the finished piece where you need it.",
    accent: "text-completed",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-28">
      <Reveal>
        <Eyebrow>The shape of a run</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-4xl leading-tight tracking-tight text-ink sm:text-[2.75rem]">
          From brief to published, on its own.
        </h2>
        <p className="mt-4 max-w-lg text-pretty text-muted">
          Every run moves through the same four steps. You set the brief and the
          approver once. Conductor handles the rest, step after step.
        </p>
      </Reveal>

      <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.name} delay={i * 90}>
            <li className="group relative h-full overflow-hidden rounded-xl border border-line-soft bg-surface p-6 transition-colors duration-300 hover:border-line">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-xs ${step.accent}`}>
                  step {step.no}
                </span>
                <span className="font-mono text-xs text-faint transition-colors duration-300 group-hover:text-muted">
                  {i < STEPS.length - 1 ? "next" : "done"}
                </span>
              </div>
              <h3 className="mt-8 font-mono text-lg text-ink">{step.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {step.blurb}
              </p>
              <div
                aria-hidden
                className="mt-6 h-px w-full origin-left scale-x-0 bg-gradient-to-r from-accent to-transparent transition-transform duration-500 group-hover:scale-x-100"
              />
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
