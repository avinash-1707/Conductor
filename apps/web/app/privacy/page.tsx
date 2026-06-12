import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/landing/icons";

export const metadata: Metadata = {
  title: "Privacy policy · Conductor",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="flex items-center gap-2 text-ink">
        <Logo className="h-5 w-5 text-accent" />
        <span className="font-mono text-sm font-medium tracking-tight">
          conductor
        </span>
      </Link>

      <h1 className="mt-10 font-display text-4xl tracking-tight">
        Privacy policy
      </h1>
      <p className="mt-2 font-mono text-xs text-faint">
        last updated · june 2026
      </p>

      <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted">
        <p>
          Conductor stores the account details you give us (name, email), your
          organization&apos;s settings, and the content your pipelines produce:
          run inputs, step outputs, and approval decisions. That history is the
          product; it is visible only to members of your organization.
        </p>
        <p>
          Your model API keys are encrypted at rest and are used only to run
          your organization&apos;s pipelines. They are never displayed after
          entry, never logged, and never shared.
        </p>
        <p>
          We do not sell your data, and we do not train models on it. We use it
          to operate the service, to debug problems you report, and for nothing
          else.
        </p>
        <p>
          You can delete your account and organization at any time; deletion
          removes your data from the live system. Questions or requests:{" "}
          <a
            href="mailto:privacy@conductor.dev"
            className="text-accent hover:underline"
          >
            privacy@conductor.dev
          </a>
          .
        </p>
      </div>
    </div>
  );
}
