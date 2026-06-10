import type { ComponentType, SVGProps } from "react";
import { Eye, Key, Ledger, Power, Rewind, Shield } from "./icons";
import { Eyebrow } from "./primitives";
import { Reveal } from "./reveal";

type Feature = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  blurb: string;
  span: string;
};

const FEATURES: Feature[] = [
  {
    icon: Power,
    title: "Nothing gets lost.",
    blurb:
      "If a run is interrupted, it picks up exactly where it stopped. No restart from zero, no work done twice.",
    span: "lg:col-span-2",
  },
  {
    icon: Shield,
    title: "A human signs off.",
    blurb:
      "Runs pause at the moments that matter and continue the second someone approves.",
    span: "",
  },
  {
    icon: Eye,
    title: "See every run at a glance.",
    blurb:
      "One board shows what is running, what needs you, and what is finished.",
    span: "",
  },
  {
    icon: Rewind,
    title: "Pick up from the last good step.",
    blurb:
      "Resume a stalled run from where it stopped, keeping everything already finished.",
    span: "",
  },
  {
    icon: Ledger,
    title: "A clear record of everything.",
    blurb:
      "Every step, input, and decision is kept, so you always know what happened and who approved it.",
    span: "",
  },
  {
    icon: Key,
    title: "Your models, your key.",
    blurb:
      "Runs use your own provider key. You stay in control of cost and choice.",
    span: "lg:col-span-2",
  },
];

export function FeatureGrid() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-28"
    >
      <Reveal>
        <Eyebrow>Why teams keep it running</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-4xl leading-tight tracking-tight text-ink sm:text-[2.75rem]">
          Built for the runs you cannot watch all day.
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <Reveal key={feature.title} delay={(i % 3) * 90} className={feature.span}>
              <article className="group relative flex h-full flex-col rounded-xl border border-line-soft bg-surface p-7 transition-colors duration-300 hover:border-line">
                <span className="grid h-10 w-10 place-items-center rounded-lg border border-line-soft bg-inset/60 text-accent transition-colors duration-300 group-hover:bg-accent/10">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-6 text-xl tracking-tight text-ink">
                  {feature.title}
                </h3>
                <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted">
                  {feature.blurb}
                </p>
              </article>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
