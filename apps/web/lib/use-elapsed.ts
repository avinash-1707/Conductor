"use client";

import { useEffect, useState } from "react";

/** Formats a millisecond span as `mm:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Live duration for a run or step. While `ticking` (the thing is running) and
 * not yet completed, a 1s interval advances `now` so the counter climbs in
 * place; otherwise it shows the static start→end span, or `—` if never started.
 * This is information, not decoration, so it ticks even under reduced motion.
 */
export function useElapsed(
  startedAt: string | null,
  completedAt: string | null,
  ticking: boolean,
): string {
  const live = ticking && !completedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : live ? now : start;
  return formatDuration(end - start);
}
