import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { Button } from "./ui";

/** A single skeleton bar. Compose these to mirror a page's real layout. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-raised ${className}`}
      aria-hidden
    />
  );
}

/** Table-row skeleton group for list pages. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Empty state: an invitation to act — icon, one sentence, one primary action. */
export function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: ComponentType<LucideProps>;
  message: string;
  action?: { label: string; onClick: () => void } | ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-lg border border-line-soft bg-surface text-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="max-w-xs text-sm text-muted">{message}</p>
      {action &&
        (typeof action === "object" && action !== null && "label" in action ? (
          <Button onClick={action.onClick} size="sm">
            {action.label}
          </Button>
        ) : (
          action
        ))}
    </div>
  );
}

/** Error state: what happened + what to do next. Never leaks internals. */
export function ErrorState({
  message = "Something went wrong loading this.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-failed/30 bg-failed/5 py-20 text-center">
      <p className="max-w-sm text-sm text-ink">{message}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * The four-state switch. Renders loading / error / empty / populated from a
 * query-like shape, so list and detail pages never improvise their states.
 */
export function Loadable<T>({
  status,
  data,
  isEmpty,
  loading,
  empty,
  error,
  children,
}: {
  status: "pending" | "error" | "success";
  data?: T;
  isEmpty?: (data: T) => boolean;
  loading: ReactNode;
  empty: ReactNode;
  error: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (status === "pending") return <>{loading}</>;
  if (status === "error" || data === undefined) return <>{error}</>;
  if (isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}
