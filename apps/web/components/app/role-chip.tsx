/**
 * Org role chip — owner carries the accent tint (interactive-yellow family is
 * reserved for interactive/identity emphasis; statuses keep their own colors).
 * Shared by Settings and the Users roster so role rendering never drifts.
 */
export function RoleChip({ role }: { role: string }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
        role === "owner" ? "border-accent/40 text-accent" : "border-line-soft text-muted"
      }`}
    >
      {role}
    </span>
  );
}
