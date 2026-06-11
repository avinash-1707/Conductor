"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { TemplateDefinition, TemplateField } from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { authClient, useSession } from "@/lib/auth-client";
import { Button, Field, Input, Label, Spinner } from "@/components/app/ui";
import { useToast } from "@/components/app/toast";

/**
 * The launch form, generated from a template's catalog field descriptors
 * (Unit 26) — one field per parameter schema key (the shared catalog test
 * enforces the mirror), validated on submit against the template's own
 * parameter schema. The hand-built Unit 23 blog form this replaces used the
 * same `POST /runs` contract.
 */

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-line bg-inset px-3 text-sm text-ink transition-colors duration-150 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function initialValues(fields: TemplateField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === "select") values[field.name] = field.defaultValue ?? field.options[0]!;
    else if (field.kind === "number")
      values[field.name] = String(field.defaultValue ?? field.min);
    else values[field.name] = "";
  }
  return values;
}

/** Raw form strings → the params shape the template schema validates. */
function toParams(
  fields: TemplateField[],
  values: Record<string, string>,
  selfId: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim();
    if (field.kind === "csv") {
      params[field.name] = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (field.kind === "number") {
      params[field.name] = Number(raw);
    } else if (field.kind === "approver") {
      params[field.name] = raw || selfId;
    } else {
      params[field.name] = raw;
    }
  }
  return params;
}

export function TemplateLaunchForm({ template }: { template: TemplateDefinition }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();

  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(template.fields),
  );
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
  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const params = toParams(template.fields, values, selfId);
    const parsed = template.paramsSchema.safeParse(params);
    if (!parsed.success) {
      setFormError("Check the form: every field is required, within its limits.");
      return;
    }
    launch.mutate({ templateKey: template.key, params });
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
      {template.fields.map((field) => {
        const value = values[field.name] ?? "";
        if (field.kind === "text" || field.kind === "csv") {
          return (
            <Field
              key={field.name}
              label={field.label}
              htmlFor={field.name}
              hint={field.hint}
            >
              <Input
                id={field.name}
                required
                maxLength={field.kind === "text" ? field.maxLength : undefined}
                placeholder={field.placeholder}
                value={value}
                onChange={(e) => setValue(field.name, e.target.value)}
              />
            </Field>
          );
        }
        if (field.kind === "number") {
          return (
            <Field key={field.name} label={field.label} htmlFor={field.name}>
              <Input
                id={field.name}
                type="number"
                min={field.min}
                max={field.max}
                required
                value={value}
                onChange={(e) => setValue(field.name, e.target.value)}
              />
            </Field>
          );
        }
        if (field.kind === "select") {
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              <select
                id={field.name}
                className={SELECT_CLASS}
                value={value}
                onChange={(e) => setValue(field.name, e.target.value)}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        // approver — org-member select defaulting to the launching user.
        const effective = value || selfId;
        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <select
              id={field.name}
              className={SELECT_CLASS}
              value={effective}
              onChange={(e) => setValue(field.name, e.target.value)}
            >
              {members.length === 0 && selfId && <option value={selfId}>You</option>}
              {members.map((m) => (
                <option key={m.id} value={m.userId}>
                  {m.userId === selfId ? "You" : m.user.name || m.user.email}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {formError && (
        <p className="rounded-md border border-failed/30 bg-failed/10 px-3 py-2 text-xs text-failed">
          {formError}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={launch.isPending || !selfId}>
          {launch.isPending && <Spinner className="h-3.5 w-3.5" />}
          Launch run
        </Button>
      </div>
    </form>
  );
}
