"use client";

import { useState, type FormEvent } from "react";
import type { z } from "zod";
import type { TemplateField } from "@conductor/shared";
import { authClient, useSession } from "@/lib/auth-client";
import { Button, Field, Input, Label, Spinner } from "@/components/app/ui";

/**
 * The generic parameter form (extracted in Unit 32) — renders catalog field
 * descriptors, validates the assembled params against the supplied schema on
 * submit, and hands them to the caller. TemplateLaunchForm wraps it for the
 * library's `POST /runs`; the canvas launch modal wraps it for
 * `POST /definitions/:id/runs`.
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

/** Raw form strings → the params shape the schema validates. */
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

export function ParamsForm({
  fields,
  schema,
  submitLabel,
  pending,
  onSubmit,
}: {
  fields: TemplateField[];
  schema: z.ZodType;
  submitLabel: string;
  pending: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();

  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(fields),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const members = org?.members ?? [];
  const selfId = session?.user.id ?? "";
  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const params = toParams(fields, values, selfId);
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      setFormError("Check the form: every field is required, within its limits.");
      return;
    }
    onSubmit(params);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
      {fields.map((field) => {
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
                // Optional csv lists (e.g. secondary keywords) may stay empty.
                required={field.kind === "text" || !field.optional}
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
        <Button type="submit" disabled={pending || !selfId}>
          {pending && <Spinner className="h-3.5 w-3.5" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
