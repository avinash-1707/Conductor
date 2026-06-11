"use client";

import type { ComponentType, DragEvent } from "react";
import { PenLine, Search, Send, UserCheck, type LucideProps } from "lucide-react";
import { activityRegistry, type GraphNodeType } from "@conductor/shared";

/**
 * The step palette (Unit 31) — one card per registered node type. Two add
 * paths: HTML5 drag onto the canvas (free placement) and click-to-add (the
 * keyboard path — appends after the chain tail and auto-draws the edge).
 */

export const NODE_DND_TYPE = "application/conductor-node";

const ENTRIES: {
  type: GraphNodeType;
  icon: ComponentType<LucideProps>;
  blurb: string;
}[] = [
  { type: "research", icon: Search, blurb: "Gathers sources and findings on the topic." },
  { type: "approval", icon: UserCheck, blurb: "Pauses for a human reviewer to approve." },
  { type: "write", icon: PenLine, blurb: "Drafts the deliverable from the research." },
  { type: "publish", icon: Send, blurb: "Delivers the finished draft." },
];

export function NodePalette({ onAdd }: { onAdd: (type: GraphNodeType) => void }) {
  function onDragStart(event: DragEvent, type: GraphNodeType) {
    event.dataTransfer.setData(NODE_DND_TYPE, type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
      <p className="hidden text-xs uppercase tracking-wide text-muted lg:block">
        Steps
      </p>
      {ENTRIES.map(({ type, icon: Icon, blurb }) => {
        const kind = activityRegistry[type].kind;
        return (
          <button
            key={type}
            type="button"
            draggable
            onDragStart={(e) => onDragStart(e, type)}
            onClick={() => onAdd(type)}
            title={`Add ${type} (drag onto the canvas, or click to append)`}
            className="group w-44 shrink-0 cursor-grab rounded-lg border border-line-soft bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing lg:w-full"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span className="truncate font-mono text-sm text-ink">{type}</span>
              </span>
              <span className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                {kind}
              </span>
            </span>
            <span className="mt-1 block text-xs text-muted">{blurb}</span>
          </button>
        );
      })}
      <p className="hidden pt-1 text-xs text-faint lg:block">
        Drag a step onto the canvas, or click to append it to the chain.
      </p>
    </div>
  );
}
