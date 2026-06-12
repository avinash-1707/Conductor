"use client";

import { useRef, useSyncExternalStore } from "react";
import { Moon, Sun } from "./icons";

const THEME_EVENT = "conductor-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function isLight() {
  return document.documentElement.classList.contains("light");
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

export function ThemeToggle() {
  // Server renders dark (no class); the snapshot reads the real DOM on the
  // client, kept in sync via a custom event the toggle dispatches.
  const light = useSyncExternalStore(subscribe, isLight, () => false);
  const ref = useRef<HTMLButtonElement>(null);

  function apply(next: boolean) {
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("conductor-theme", next ? "light" : "dark");
    } catch {
      /* storage may be unavailable; the toggle still works for the session */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  function toggle() {
    const next = !light;
    const doc = document as DocumentWithViewTransition;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Preferred path: a View Transition that reveals the new theme in a
    // circle growing out of the toggle button itself.
    if (!reduced && typeof doc.startViewTransition === "function") {
      const rect = ref.current?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
      const y = rect ? rect.top + rect.height / 2 : 40;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      doc
        .startViewTransition(() => apply(next))
        .ready.then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 600,
              easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        })
        .catch(() => {
          /* transition was skipped (rapid toggling); the theme still applied */
        });
      return;
    }

    // Fallback: a one-shot color cross-fade (skipped under reduced motion,
    // where the global rule collapses transitions to instant anyway).
    const root = document.documentElement;
    root.classList.add("theme-fade");
    apply(next);
    window.setTimeout(() => root.classList.remove("theme-fade"), 480);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="relative grid h-9 w-9 place-items-center rounded-md border border-line-soft bg-surface/50 text-muted transition-[background-color,border-color,color,transform] duration-200 hover:bg-raised hover:text-ink active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <Sun
        className={`absolute h-4 w-4 transition-all duration-300 ${
          light
            ? "rotate-0 scale-100 opacity-100 blur-0"
            : "-rotate-45 scale-75 opacity-0 blur-[2px]"
        }`}
      />
      <Moon
        className={`absolute h-4 w-4 transition-all duration-300 ${
          light
            ? "rotate-45 scale-75 opacity-0 blur-[2px]"
            : "rotate-0 scale-100 opacity-100 blur-0"
        }`}
      />
    </button>
  );
}
