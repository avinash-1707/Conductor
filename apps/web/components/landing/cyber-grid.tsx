"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface Beam {
  id: number;
  secondary: boolean;
  style: CSSProperties;
}

/**
 * Hero backdrop: perspective grid floor, breathing accent glow, and rising
 * light beams, all in brand tokens (accent beams with the occasional
 * running-blue one). Beams are generated client-side after mount, so the
 * server markup stays deterministic; under prefers-reduced-motion none are
 * created and the floor/glow freeze via the global rule.
 */
export function CyberGrid({ beamCount = 26 }: { beamCount?: number }) {
  const [beams, setBeams] = useState<Beam[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => {
      setBeams(
        Array.from({ length: beamCount }, (_, i) => ({
          id: i,
          secondary: Math.random() < 0.16,
          style: {
            left: `${(Math.random() * 100).toFixed(2)}%`,
            width: `${Math.random() < 0.3 ? 2 : 1}px`,
            "--dur": `${(Math.random() * 3 + 5).toFixed(2)}s`,
            "--delay": `${(Math.random() * 6).toFixed(2)}s`,
          } as CSSProperties,
        })),
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, [beamCount]);

  return (
    <div className="cyber-scene" aria-hidden>
      <div className="cyber-floor">
        <div className="cyber-floor-grid" />
      </div>
      <div className="cyber-column" />
      <div className="cyber-glow" />
      {beams.map((beam) => (
        <span
          key={beam.id}
          className={`cyber-beam ${beam.secondary ? "secondary" : ""}`}
          style={beam.style}
        />
      ))}
    </div>
  );
}
