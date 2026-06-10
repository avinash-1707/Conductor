import { Eyebrow } from "./primitives";
import { RecoveryDemo } from "./recovery-demo";
import { Reveal } from "./reveal";

export function Reliability() {
  return (
    <section
      id="reliability"
      className="relative scroll-mt-24 overflow-hidden border-y border-line-soft bg-surface/40 py-28"
    >
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <div className="max-w-md">
            <Eyebrow>The hard part, handled</Eyebrow>
            <h2 className="mt-4 text-4xl leading-tight tracking-tight text-ink sm:text-[2.75rem]">
              We break it <span className="italic text-accent">on purpose.</span>
            </h2>
            <p className="mt-5 text-pretty leading-relaxed text-muted">
              The hardest part of running AI work is the failure you never see.
              So we built for it first. Pull the plug in the middle of a run and
              watch it come back, finish the job, and keep the receipts.
            </p>
            <p className="mt-5 font-mono text-xs text-faint">
              The same thing happens whether the cause is a crash, a bad
              connection, or a machine that simply stops.
            </p>
          </div>
        </Reveal>

        <Reveal delay={140}>
          <RecoveryDemo />
        </Reveal>
      </div>
    </section>
  );
}
