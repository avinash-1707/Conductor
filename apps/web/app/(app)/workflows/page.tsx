"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { blogPostPipelineInputSchema, blogToneSchema } from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { authClient, useSession } from "@/lib/auth-client";
import { Button, Card, Field, Input, Label, Spinner } from "@/components/app/ui";
import { useToast } from "@/components/app/toast";

/**
 * Workflow Library — the Unit 23 pre-template slice: one curated card for the
 * hardcoded Blog Post Pipeline with a hand-built launch form. Unit 26 replaces
 * this with the spec-driven library (forms generated from each template's
 * parameter schema); the launch contract (`POST /runs`) is the same one it
 * will use.
 */

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-line bg-inset px-3 text-sm text-ink transition-colors duration-150 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export default function WorkflowsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();

  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState<string>("professional");
  const [wordCount, setWordCount] = useState("1200");
  const [approverId, setApproverId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const launch = useMutation({
    mutationFn: api.runs.create,
    onSuccess: (run) => {
      toast("Launched");
      router.push(`/runs/${run.id}`);
    },
    onError: (err) => {
      toast(
        err instanceof ApiError
          ? err.message
          : "The run could not be started. Try again.",
        "error",
      );
    },
  });

  const members = org?.members ?? [];
  const selfId = session?.user.id ?? "";
  const effectiveApprover = approverId || selfId;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = blogPostPipelineInputSchema.safeParse({
      topic: topic.trim(),
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      tone,
      wordCount: Number(wordCount),
      approverId: effectiveApprover,
    });
    if (!parsed.success) {
      setFormError(
        "Check the form: every field is required, with at least one keyword and 100–5000 words.",
      );
      return;
    }
    launch.mutate(parsed.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Curated pipelines, ready to configure and run. More templates arrive
        with the template library.
      </p>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <h2 className="text-sm font-medium text-ink">Blog Post Pipeline</h2>
            <p className="text-xs text-muted">
              research → approval → write → publish. Research streams live,
              pauses for your reviewer, then drafts and delivers.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <Field label="Topic" htmlFor="topic">
            <Input
              id="topic"
              required
              maxLength={200}
              placeholder="Why durable workflows stop AI runs from vanishing"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>

          <Field
            label="Target keywords"
            htmlFor="keywords"
            hint="Comma-separated, up to 10."
          >
            <Input
              id="keywords"
              required
              placeholder="durable execution, ai pipelines"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tone">Tone</Label>
              <select
                id="tone"
                className={SELECT_CLASS}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                {blogToneSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <Field label="Word count" htmlFor="word-count">
              <Input
                id="word-count"
                type="number"
                min={100}
                max={5000}
                required
                value={wordCount}
                onChange={(e) => setWordCount(e.target.value)}
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="approver">Who approves</Label>
              <select
                id="approver"
                className={SELECT_CLASS}
                value={effectiveApprover}
                onChange={(e) => setApproverId(e.target.value)}
              >
                {members.length === 0 && selfId && (
                  <option value={selfId}>You</option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.userId}>
                    {m.userId === selfId
                      ? "You"
                      : m.user.name || m.user.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {formError && (
            <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
              {formError}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={launch.isPending || !effectiveApprover}>
              {launch.isPending && <Spinner className="h-3.5 w-3.5" />}
              Launch run
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
