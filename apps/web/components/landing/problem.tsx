import { Folio } from "./primitives";
import { Reveal } from "./reveal";

const INCIDENTS = [
  {
    time: "02:47",
    text: "The research step timed out. Nothing told anyone. The client asked where their posts were on Friday.",
    tag: "failed · silently",
    tone: "text-failed",
  },
  {
    time: "11:20",
    text: "The approval lives in a Slack thread, forty messages deep, somewhere under the lunch orders.",
    tag: "waiting · lost",
    tone: "text-suspended",
  },
  {
    time: "16:05",
    text: "One step failed, so someone re-ran all five. Every token billed twice, every finished step redone.",
    tag: "retried · expensive",
    tone: "text-retrying",
  },
];

/**
 * §01 — the problem, told as three entries from an incident log nobody keeps.
 */
export function Problem() {
  return (
    <section id="problem" className="scroll-mt-24 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <Folio n="01" title="The problem" />
        </Reveal>

        <Reveal delay={80}>
          <h2 className="mt-10 max-w-3xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            Right now, your pipelines run on{" "}
            <em className="italic text-accent">hope</em>.
          </h2>
        </Reveal>

        <div className="mt-14">
          {INCIDENTS.map((incident, i) => (
            <Reveal key={incident.time} delay={120 + i * 90}>
              <div className="group grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 border-t border-line-soft py-6 transition-colors duration-200 hover:bg-surface/60 sm:grid-cols-[5rem_1fr_auto] sm:gap-x-10 md:px-4">
                <span className="font-mono text-sm tabular-nums text-faint">
                  {incident.time}
                </span>
                <p className="max-w-2xl text-base leading-relaxed text-muted transition-colors duration-200 group-hover:text-ink">
                  {incident.text}
                </p>
                <span
                  className={`col-start-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] sm:col-start-3 ${incident.tone}`}
                >
                  {incident.tag}
                </span>
              </div>
            </Reveal>
          ))}
          <div className="border-t border-line-soft" />
        </div>

        <Reveal delay={160}>
          <p className="mt-14 max-w-2xl text-lg leading-relaxed text-muted">
            You already built the agents. It&apos;s the{" "}
            <span className="text-ink">operations</span> that break — the
            crashes nobody sees, the approvals nobody finds, the retries
            everybody pays for. Conductor is the operations half.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
