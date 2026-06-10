import { Reveal } from "./reveal";

const ITEMS = [
  "survives crashes",
  "resumes in seconds",
  "human approvals built in",
  "full record of every run",
  "your own model key",
];

export function TrustStrip() {
  return (
    <Reveal>
      <section className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-y border-line-soft py-5 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-faint">
          {ITEMS.map((item, i) => (
            <span key={item} className="flex items-center gap-3">
              {i > 0 && <span className="text-line">/</span>}
              {item}
            </span>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
