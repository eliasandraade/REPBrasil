/**
 * Ponto de referência de um território (pulso e mapa de calor), calculado da malha oficial do IBGE. É o centroide
 * de área do maior polígono quando ele cai dentro do território; em formas côncavas, o meio do maior trecho interno
 * da linha horizontal que passa pelo centroide. Nada é digitado à mão.
 */

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];
export type PolygonGeometry = { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] };

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

function ringCentroid(ring: Ring): Position {
  const area = signedArea(ring);
  if (area === 0) return ring[0];
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function inRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPolygon(point: Position, polygon: Polygon): boolean {
  if (!inRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => inRing(point, hole));
}

/** Meio do maior trecho interno da horizontal y (bordas e furos incluídos). */
function scanlineMidpoint(polygon: Polygon, y: number): Position | null {
  const xs: number[] = [];
  for (const ring of polygon)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
  xs.sort((a, b) => a - b);
  let best: Position | null = null;
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, y];
    }
  }
  return best;
}

export function insidePoint(geometry: PolygonGeometry): Position {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const largest = polygons.reduce((a, b) => (Math.abs(signedArea(b[0])) > Math.abs(signedArea(a[0])) ? b : a));
  const centroid = ringCentroid(largest[0]);
  if (inPolygon(centroid, largest)) return centroid;
  return scanlineMidpoint(largest, centroid[1]) ?? largest[0][0];
}
