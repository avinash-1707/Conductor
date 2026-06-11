"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { TemplateDefinition } from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/app/toast";
import { ParamsForm } from "@/components/app/params-form";

/**
 * The template launch form (Unit 26) — a thin wrapper over the generic
 * ParamsForm (extracted in Unit 32): catalog field descriptors + the
 * template's own parameter schema + the `POST /runs` mutation.
 */
export function TemplateLaunchForm({ template }: { template: TemplateDefinition }) {
  const router = useRouter();
  const { toast } = useToast();

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

  return (
    <ParamsForm
      fields={template.fields}
      schema={template.paramsSchema}
      submitLabel="Launch run"
      pending={launch.isPending}
      onSubmit={(params) => launch.mutate({ templateKey: template.key, params })}
    />
  );
}
