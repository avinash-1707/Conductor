/**
 * Small presentation helpers shared by the run surfaces (dashboard + detail).
 * Customer-facing vocabulary only — never "workflow execution"/"activity".
 */

/** Maps an internal workflow name to product vocabulary for display. */
export function workflowLabel(name: string): string {
  if (name === "contentPipeline") return "Blog Post Pipeline";
  return name;
}

/** Shortens a run id for compact mono display (`run-1a2b…ef90` style). */
export function shortRunId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Relative time like `12s ago`, `4m ago`, `3h ago`, `2d ago`. */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
