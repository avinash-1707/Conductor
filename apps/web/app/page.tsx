import { CallToAction } from "../components/landing/cta";
import { FeatureGrid } from "../components/landing/feature-grid";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Reliability } from "../components/landing/reliability";
import { SiteFooter } from "../components/landing/site-footer";
import { SiteNav } from "../components/landing/site-nav";
import { TrustStrip } from "../components/landing/trust-strip";

export default function Home() {
  return (
    <>
      <div className="atmosphere" aria-hidden />
      <SiteNav />
      <main>
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <Reliability />
        <FeatureGrid />
        <CallToAction />
      </main>
      <SiteFooter />
    </>
  );
}
