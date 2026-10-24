import type { TerritoryCollection } from "@/lib/elections/geo";
import { insidePoint } from "@/lib/territory/centroid";

/**
 * Projeção da malha oficial de UFs do IBGE (public/geo/br-uf.json) para SVG, calculada UMA vez no servidor:
 * o navegador recebe só o traçado pronto (sem MapLibre, sem WebGL, sem baixar o GeoJSON).
 *
 * Projeção equiretangular com correção do cosseno na latitude média do país — suficiente para um mapa
 * coroplético de 27 UFs (não é cartografia de precisão; a geometria oficial não é editada, só projetada e
 * simplificada para a escala da tela).
 */

export interface UfShape {
  uf: string;
  name: string;
  /** Path SVG (coordenadas da viewBox, 1 casa decimal). */
  d: string;
  /** Ponto interno para o rótulo. */
  labelX: number;
  labelY: number;
  /** Área relativa (para rótulos de UFs pequenas). */
  area: number;
}

export interface BrazilMapShapes {
  width: number;
  height: number;
  shapes: UfShape[];
}

type Position = [number, number];

/** Rótulos de UFs pequenas saem do contorno (para o oceano), com linha-guia: deslocamento em unidades da viewBox. */
const LABEL_OFFSETS: Readonly<Record<string, Position>> = {
  RN: [46, -18],
  PB: [58, 0],
  PE: [62, 14],
  AL: [52, 26],
  SE: [44, 34],
  ES: [40, 14],
  RJ: [34, 30],
  DF: [26, -22],
  SC: [44, 8],
};

export const SMALL_UF_LABELS = Object.keys(LABEL_OFFSETS);

export function projectBrazil(collection: TerritoryCollection, width = 1000): BrazilMapShapes {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = ([lon, lat]: Position) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };
  for (const f of collection.features) {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polygons) for (const ring of poly) for (const p of ring) visit(p as Position);
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = width / ((maxLon - minLon) * k);
  const height = Math.round((maxLat - minLat) * scale);
  const project = ([lon, lat]: Position): Position => [(lon - minLon) * k * scale, (maxLat - lat) * scale];
  const r1 = (n: number) => Math.round(n * 10) / 10;

  const shapes = collection.features.map((f) => {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = "";
    let area = 0;
    for (const poly of polygons) {
      for (const ring of poly) {
        const pts = (ring as Position[]).map(project);
        // Simplificação de tela: pontos a menos de ~0,8 unidade do último mantido não mudam o desenho.
        const kept: Position[] = [];
        for (const p of pts) {
          const last = kept[kept.length - 1];
          if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.8) kept.push(p);
        }
        if (kept.length < 3) continue;
        d += `M${r1(kept[0][0])} ${r1(kept[0][1])}`;
        for (let i = 1; i < kept.length; i++) d += `L${r1(kept[i][0])} ${r1(kept[i][1])}`;
        d += "Z";
        let a = 0;
        for (let i = 0, j = kept.length - 1; i < kept.length; j = i++) a += kept[j][0] * kept[i][1] - kept[i][0] * kept[j][1];
        area += Math.abs(a) / 2;
      }
    }
    const [lx, ly] = project(insidePoint(f.geometry) as Position);
    const offset = LABEL_OFFSETS[f.properties.uf];
    return {
      uf: f.properties.uf,
      name: f.properties.name,
      d,
      labelX: r1(lx + (offset?.[0] ?? 0)),
      labelY: r1(ly + (offset?.[1] ?? 0)),
      area: Math.round(area),
    };
  });
  shapes.sort((a, b) => a.uf.localeCompare(b.uf));
  return { width, height, shapes };
}

/** Âncora da linha-guia (ponto interno real) para UFs com rótulo deslocado. */
export function labelAnchor(shape: UfShape): Position | null {
  const offset = LABEL_OFFSETS[shape.uf];
  if (!offset) return null;
  return [shape.labelX - offset[0], shape.labelY - offset[1]];
}
