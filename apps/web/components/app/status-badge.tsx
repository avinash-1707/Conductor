import type { RunStatus, StepStatus } from "@conductor/shared";

type AnyStatus = RunStatus | StepStatus;

type Tone =
  | "pending"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

// Status -> display label + semantic tone. The ONLY place status maps to color
// (code-standards: never reimplement status colors locally).
const STATUS: Record<AnyStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "pending" },
  running: { label: "Running", tone: "running" },
  suspended: { label: "Suspended", tone: "suspended" },
  completed: { label: "Completed", tone: "completed" },
  failed: { label: "Failed", tone: "failed" },
  retrying: { label: "Retrying", tone: "retrying" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
  rejected: { label: "Rejected", tone: "cancelled" },
  expired: { label: "Expired", tone: "cancelled" },
};

// Literal class strings per tone (Tailwind cannot resolve interpolated names).
const TONE: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  pending: { text: "text-pending", bg: "bg-pending/12", border: "border-pending/25", dot: "bg-pending" },
  running: { text: "text-running", bg: "bg-running/12", border: "border-running/25", dot: "bg-running" },
  suspended: { text: "text-suspended", bg: "bg-suspended/12", border: "border-suspended/25", dot: "bg-suspended" },
  completed: { text: "text-completed", bg: "bg-completed/12", border: "border-completed/25", dot: "bg-completed" },
  failed: { text: "text-failed", bg: "bg-failed/12", border: "border-failed/25", dot: "bg-failed" },
  retrying: { text: "text-retrying", bg: "bg-retrying/12", border: "border-retrying/25", dot: "bg-retrying" },
  cancelled: { text: "text-cancelled", bg: "bg-cancelled/12", border: "border-cancelled/25", dot: "bg-cancelled" },
};

export function StatusBadge({
  status,
  className = "",
}: {
  status: AnyStatus;
  className?: string;
}) {
  const { label, tone } = STATUS[status];
  const c = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs ${c.text} ${c.bg} ${c.border} ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${c.dot} ${tone === "running" ? "node-pulse" : ""}`}
      />
      {label}
    </span>
  );
}

/**
 * The status dot on its own — used as a timeline-rail node marker (Unit 19).
 * Same centralized color map as the badge; the running tone carries the brand's
 * single meaningful pulse (reduced-motion disables it globally).
 */
/**
 * The badge's border tint for a status — lets other surfaces (the canvas
 * viewer's node frames, Unit 30) borrow the same centralized tone map without
 * re-implementing status colors locally.
 */
export function statusBorderClass(status: AnyStatus): string {
  return TONE[STATUS[status].tone].border;
}

export function StatusDot({
  status,
  className = "",
}: {
  status: AnyStatus;
  className?: string;
}) {
  const { tone } = STATUS[status];
  const c = TONE[tone];
  return (
    <span
      className={`block h-3 w-3 rounded-full ${c.dot} ${tone === "running" ? "node-pulse" : ""} ${className}`}
      aria-hidden
    />
  );
}
