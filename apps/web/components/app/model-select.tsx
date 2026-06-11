"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Star } from "lucide-react";
import type { ModelOption } from "@conductor/shared";

/**
 * Model picker listbox (Unit 33). A native <select> cannot render icons, and
 * paid models carry a star marker — so this is a small hand-rolled listbox
 * (same deferred-shadcn stance as the other app primitives): Input-styled
 * trigger, --bg-raised popover, provider groups, full keyboard support
 * (ArrowUp/Down, Home/End, Enter/Space, Escape) and a visible accent ring.
 *
 * `value === null` selects the leading "Default" option; a saved model that
 * has rotated out of the catalog still renders as a selectable current value
 * so the trigger never lies about what is stored.
 */

type Item = {
  id: string | null;
  label: string;
  group: string;
  free: boolean;
  mono?: boolean;
};

const GROUP_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

function groupLabel(provider: string, free: boolean): string {
  if (free) return "Free";
  return GROUP_LABELS[provider] ?? provider;
}

export function ModelSelect({
  id,
  value,
  defaultModel,
  options,
  disabled = false,
  onChange,
}: {
  id: string;
  /** The stored model id, or null for the platform default. */
  value: string | null;
  /** Platform default slug, shown on the leading "Default" option. */
  defaultModel: string;
  options: ModelOption[];
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const items = useMemo<Item[]>(() => {
    const catalog: Item[] = [
      { id: null, label: `Default — ${defaultModel}`, group: "Default", free: true, mono: true },
      ...options.map((o) => ({
        id: o.id,
        label: o.name,
        group: groupLabel(o.provider, o.free),
        free: o.free,
      })),
    ];
    // A stored model missing from the curated catalog still has to be visible
    // and re-selectable — render it under its own group, labelled by slug.
    if (value !== null && !options.some((o) => o.id === value)) {
      catalog.push({ id: value, label: value, group: "Current", free: true, mono: true });
    }
    return catalog;
  }, [options, defaultModel, value]);

  const selected = items.find((i) => i.id === value) ?? items[0]!;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    const idx = items.findIndex((i) => i.id === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function pick(index: number) {
    const item = items[index];
    if (!item) return;
    onChange(item.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(items.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 text-left text-sm text-ink transition-colors duration-150 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-55"
      >
        <span className={`flex min-w-0 items-center gap-2 ${selected.mono ? "font-mono text-xs" : ""}`}>
          {!selected.free && <Star className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Paid model" />}
          <span className="truncate">{selected.label}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={id}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-[var(--shadow-card)]"
        >
          {items.map((item, index) => {
            const firstOfGroup = index === 0 || items[index - 1]!.group !== item.group;
            return (
              <li key={item.id ?? "__default"}>
                {firstOfGroup && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-faint">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={item.id === value}
                  onClick={() => pick(index)}
                  onMouseMove={() => setActive(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    index === active ? "bg-inset text-ink" : "text-muted"
                  }`}
                >
                  {!item.free ? (
                    <Star className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Paid model" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className={`min-w-0 flex-1 truncate ${item.mono ? "font-mono text-xs" : ""}`}>
                    {item.label}
                  </span>
                  {item.id === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
