"use client";

import { useEffect, useRef, useState } from "react";

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function formatBR(n: number) {
  return n.toLocaleString("pt-BR");
}

interface AnimatedStatCardProps {
  numericTarget?: number;
  numericStart?: number;
  suffix?: string;
  displayValue: string;
  label: string;
  note?: string;
  tooltip: string;
  duration?: number;
}

export function AnimatedStatCard({
  numericTarget,
  numericStart = 0,
  suffix = "",
  displayValue,
  label,
  note,
  tooltip,
  duration = 1100,
}: AnimatedStatCardProps) {
  const [current, setCurrent] = useState<number | null>(
    numericTarget != null ? numericStart : null,
  );
  const [started, setStarted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Trigger counter when card enters viewport
  useEffect(() => {
    if (numericTarget == null) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [numericTarget]);

  // Animated counter
  useEffect(() => {
    if (!started || numericTarget == null) return;
    const startTime = performance.now();
    const range = numericTarget - numericStart;

    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      setCurrent(Math.round(numericStart + range * easeOutExpo(t)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [started, numericTarget, numericStart, duration]);

  const valueDisplay =
    numericTarget != null && current != null
      ? formatBR(current) + suffix
      : displayValue;

  return (
    <div
      ref={ref}
      className="relative rounded-lg border border-white/8 bg-card p-4 text-center cursor-default transition-all duration-200 hover:border-brand/30 hover:bg-card-elevated hover:shadow-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="text-2xl font-bold text-brand tabular-nums">{valueDisplay}</p>
      <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
      {note && <p className="mt-0.5 text-xs text-slate-600">{note}</p>}

      {/* Hover tooltip */}
      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 w-60 -translate-x-1/2 rounded-lg border border-white/10 bg-card-elevated p-3 text-left shadow-card"
          role="tooltip"
        >
          <p className="text-xs leading-relaxed text-slate-400">{tooltip}</p>
          {/* Arrow */}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-full -translate-x-1/2"
            style={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid #111d2e",
            }}
          />
        </div>
      )}
    </div>
  );
}
