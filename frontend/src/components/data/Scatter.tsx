"use client";

import { useMemo } from "react";

export interface ScatterPoint {
  code: string;
  name: string;
  x: number;
  y: number;
}

/**
 * Dispersão por município (SVG). Cada ponto é um território, nunca uma pessoa. O território escolhido ou em foco
 * (mapa/tabela) aparece destacado; o nome e os dois valores estão no título de cada ponto e na tabela da página.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
  selected,
  hovered,
  onHover,
  summary,
}: Readonly<{
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  selected: string | null;
  hovered: string | null;
  onHover: (code: string | null) => void;
  summary: string;
}>) {
  const plotted = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    return {
      minX,
      maxX,
      minY,
      maxY,
      dots: points.map((p) => ({ ...p, cx: 56 + ((p.x - minX) / dx) * 500, cy: 236 - ((p.y - minY) / dy) * 200 })),
    };
  }, [points]);
  if (!plotted) return null;
  const focus = new Set([selected, hovered].filter(Boolean));
  return (
    <figure className="overflow-x-auto" data-testid="data-scatter">
      <svg viewBox="0 0 600 290" className="min-w-[540px] text-fg" role="img" aria-label={summary}>
        <line x1="56" y1="236" x2="568" y2="236" stroke="currentColor" opacity="0.2" />
        <line x1="56" y1="28" x2="56" y2="236" stroke="currentColor" opacity="0.2" />
        <text x="56" y="252" fontSize="10" fill="currentColor" opacity="0.6">{formatX(plotted.minX)}</text>
        <text x="568" y="252" fontSize="10" fill="currentColor" opacity="0.6" textAnchor="end">{formatX(plotted.maxX)}</text>
        <text x="50" y="236" fontSize="10" fill="currentColor" opacity="0.6" textAnchor="end">{formatY(plotted.minY)}</text>
        <text x="50" y="34" fontSize="10" fill="currentColor" opacity="0.6" textAnchor="end">{formatY(plotted.maxY)}</text>
        <text x="312" y="278" fontSize="11" fill="currentColor" opacity="0.7" textAnchor="middle">{xLabel}</text>
        <text transform="translate(14 132) rotate(-90)" fontSize="11" fill="currentColor" opacity="0.7" textAnchor="middle">{yLabel}</text>
        {plotted.dots.map((dot) => (
          <circle
            key={dot.code}
            cx={dot.cx}
            cy={dot.cy}
            r={focus.has(dot.code) ? 6 : 3.5}
            fill={focus.has(dot.code) ? "rgb(var(--accent))" : "currentColor"}
            opacity={focus.has(dot.code) ? 1 : 0.5}
            onMouseEnter={() => onHover(dot.code)}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${dot.name}: ${formatX(dot.x)} · ${formatY(dot.y)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}
