import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type RunStatus =
  | "pending"
  | "running"
  | "suspended"
  | "completed"
  | "retrying"
  | "failed"
  | "cancelled";

const DOT: Record<RunStatus, string> = {
  pending: "bg-pending",
  running: "bg-running",
  suspended: "bg-suspended",
  completed: "bg-completed",
  retrying: "bg-retrying",
  failed: "bg-failed",
  cancelled: "bg-cancelled",
};

const TEXT: Record<RunStatus, string> = {
  pending: "text-pending",
  running: "text-running",
  suspended: "text-suspended",
  completed: "text-completed",
  retrying: "text-retrying",
  failed: "text-failed",
  cancelled: "text-cancelled",
};

export function StatusDot({
  status,
  pulse = false,
  className = "",
}: {
  status: RunStatus;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]} ${
        pulse ? "node-pulse" : ""
      } ${className}`}
    />
  );
}

export function statusText(status: RunStatus) {
  return TEXT[status];
}

export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[0.7rem] uppercase tracking-[0.24em] text-faint ${className}`}
    >
      {children}
    </span>
  );
}

const BUTTON_BASE =
  "group inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const BUTTON_SIZE = {
  md: "h-11 px-5",
  sm: "h-9 px-4",
} as const;

// The vivid fill is wired through arbitrary CSS-var values so it never depends
// on a theme-color utility being registered (keeps it robust across rebuilds).
const BUTTON_VARIANT = {
  primary:
    "bg-[var(--accent-fill)] text-[var(--accent-fg)] hover:bg-[var(--accent-fill-hi)] shadow-[0_10px_30px_-12px_var(--glow-accent)]",
  ghost:
    "border border-line bg-surface/50 text-ink hover:bg-raised hover:border-line",
  danger:
    "border border-line bg-surface/50 text-failed hover:bg-raised hover:border-[color:var(--status-failed)]",
} as const;

export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  className?: string;
  external?: boolean;
}) {
  const cls = `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`;
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** A real <button> sharing the link Button's visual language — for the
 *  interactive demos (approve, reject, kill the worker). */
export function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  size = "md",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} disabled:pointer-events-none disabled:opacity-45 ${className}`}
    >
      {children}
    </button>
  );
}

/** Status badge: dot + label on a dim tint of the status color. */
export function StatusBadge({
  status,
  label,
  className = "",
}: {
  status: RunStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.14em] ${TEXT[status]} ${className}`}
      style={{
        backgroundColor: "color-mix(in oklab, currentColor 11%, transparent)",
      }}
    >
      <StatusDot status={status} pulse={status === "running"} />
      {label ?? status}
    </span>
  );
}

/** Editorial section header: `§ NN ——————— TITLE` in mono over a hairline. */
export function Folio({
  n,
  title,
  className = "",
}: {
  n: string;
  title: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 font-mono text-[0.7rem] uppercase tracking-[0.24em] text-faint ${className}`}
    >
      <span className="text-accent">§ {n}</span>
      <span aria-hidden className="h-px flex-1 self-center bg-line-soft" />
      <span>{title}</span>
    </div>
  );
}

/** A surface card with the brand's adaptive border + shadow (Jakub: shadows
 *  adapt to either theme where a single solid border would clash). */
export function Panel({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`rounded-xl border border-line-soft bg-surface shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}
