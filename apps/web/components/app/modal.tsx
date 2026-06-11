"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Minimal modal per ui-context (Unit 32 — the canvas launch form is the first
 * true overlay): centered panel on --bg-raised, rounded-xl, blurred black/60
 * backdrop. Motion: one 200ms scale+fade enter (rare interaction — Jakub
 * polish); the global reduced-motion rule collapses it. Esc and the backdrop
 * close it.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-enter relative w-full max-w-md rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
