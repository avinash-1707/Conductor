"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "./icons";

const THEME_EVENT = "conductor-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function isLight() {
  return document.documentElement.classList.contains("light");
}

export function ThemeToggle() {
  // Server renders dark (no class); the snapshot reads the real DOM on the
  // client, kept in sync via a custom event the toggle dispatches.
  const light = useSyncExternalStore(subscribe, isLight, () => false);

  function toggle() {
    const next = !light;
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("conductor-theme", next ? "light" : "dark");
    } catch {
      /* storage may be unavailable; the toggle still works for the session */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="relative grid h-9 w-9 place-items-center rounded-md border border-line-soft bg-surface/50 text-muted transition-colors duration-200 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
