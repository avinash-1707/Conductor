import { CallToAction } from "../components/landing/cta";
import { FeatureIndex } from "../components/landing/feature-index";
import { Hero } from "../components/landing/hero";
import { Problem } from "../components/landing/problem";
import { Reliability } from "../components/landing/reliability";
import { RunStory } from "../components/landing/run-story";
import { DemoRunProvider } from "../components/landing/run-provider";
import { SiteFooter } from "../components/landing/site-footer";
import { SiteNav } from "../components/landing/site-nav";

export default function Home() {
  return (
    <div id="top">
      <div className="atmosphere" aria-hidden />
      <SiteNav />
      <main>
        {/* The hero ledger and the run story share one demo run: it starts on
            load, suspends at the gate, and resumes when the visitor approves. */}
        <DemoRunProvider>
          <Hero />
          <Problem />
          <RunStory />
        </DemoRunProvider>
        <Reliability />
        <FeatureIndex />
        <CallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}
