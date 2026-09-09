"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Spinner } from "@/components/app/ui";

/** Creates an owner-authorized durable draft, then hands editing to its shareable URL. */
export default function CanvasPage() {
  const router = useRouter();
  const createDraft = useMutation({
    mutationFn: () => api.canvasDrafts.create(),
    onSuccess: (draft) => router.replace(`/canvas/${draft.id}`),
  });

  useEffect(() => {
    if (!createDraft.isIdle) return;
    createDraft.mutate();
  }, [createDraft]);

  if (createDraft.isError) {
    const message =
      createDraft.error instanceof ApiError
        ? createDraft.error.message
        : "A new canvas draft could not be created.";
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-failed/25 bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 text-failed">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <h1 className="text-lg">Canvas unavailable</h1>
        </div>
        <p className="text-sm text-muted">{message}</p>
        <p className="text-xs text-faint">
          Only organization owners can create and edit collaborative drafts.
        </p>
        <Button size="sm" className="self-start" onClick={() => createDraft.reset()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="grid min-h-[420px] place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner />
        Creating collaborative draft…
      </div>
    </div>
  );
}
