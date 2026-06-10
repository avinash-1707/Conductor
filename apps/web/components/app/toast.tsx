"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tone = "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastContext {
  toast: (message: string, tone?: Tone) => void;
}

const Ctx = createContext<ToastContext | null>(null);

/**
 * Minimal toast surface (ui-context: an action's outcome is confirmed with a
 * toast using the same verb as the button). Bottom-right stack, tone-colored
 * accent, auto-dismiss. Mounted once in the AppShell.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`rise pointer-events-auto flex items-center gap-2 rounded-md border-l-2 bg-raised px-3 py-2 text-sm text-ink shadow-[var(--shadow-card)] ${
              t.tone === "error" ? "border-failed" : "border-completed"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${t.tone === "error" ? "bg-failed" : "bg-completed"}`}
            />
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
