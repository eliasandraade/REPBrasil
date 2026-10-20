/**
 * Posição do rótulo do mapa: perto do ponteiro, sempre dentro da área do mapa e, quando possível, fora do
 * território selecionado (o rótulo não cobre o que a pessoa está lendo). Só geometria: nenhum DOM aqui.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TooltipSide = "se" | "sw" | "ne" | "nw";

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function placeTooltip(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  avoid: Box | null = null,
  gap = 12,
  margin = 8,
): { x: number; y: number; side: TooltipSide } {
  const candidates: Array<{ side: TooltipSide; x: number; y: number }> = [
    { side: "se", x: anchor.x + gap, y: anchor.y + gap },
    { side: "sw", x: anchor.x - gap - size.width, y: anchor.y + gap },
    { side: "ne", x: anchor.x + gap, y: anchor.y - gap - size.height },
    { side: "nw", x: anchor.x - gap - size.width, y: anchor.y - gap - size.height },
  ];
  const fits = (c: { x: number; y: number }) =>
    c.x >= margin && c.y >= margin && c.x + size.width <= bounds.width - margin && c.y + size.height <= bounds.height - margin;
  const cost = (c: { x: number; y: number }) => (avoid ? overlap({ ...c, ...size }, avoid) : 0);
  const fitting = candidates.filter(fits);
  const pool = fitting.length ? fitting : candidates;
  const best = pool.reduce((a, b) => (cost(b) < cost(a) ? b : a), pool[0]);
  const clamp = (v: number, max: number) => Math.min(Math.max(v, margin), Math.max(margin, max - margin));
  return { side: best.side, x: clamp(best.x, bounds.width - size.width), y: clamp(best.y, bounds.height - size.height) };
}
