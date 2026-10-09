import type { ExplorerLevel } from "./route";

/**
 * Malhas territoriais oficiais (IBGE, API de malhas v3, qualidade "minima"),
 * geradas por scripts/fetch-ibge-geo.mjs em /public/geo (proveniência em
 * /public/geo/meta.json). IBGE = geografia; TSE = eleição, zona, seção, voto.
 * Bounds de câmera vêm SEMPRE da geometria oficial — nunca digitados à mão.
 */
export const UF_MESH_URL = "/geo/br-uf.json";

/**
 * Malhas municipais publicadas, por código IBGE da UF. Uma UF sem malha ainda
 * navega pelo catálogo; o mapa só não desenha seus municípios.
 */
export const MUNICIPALITY_MESHES: Record<string, string> = {
  "23": "/geo/ce-municipios.json",
};

type Position = [number, number];
type Geometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };

export interface TerritoryFeature {
  type: "Feature";
  id: number;
  properties: { code: string; name: string; uf: string };
  geometry: Geometry;
}

export interface TerritoryCollection {
  type: "FeatureCollection";
  features: TerritoryFeature[];
}

export interface TerritoryGeo {
  ufs: TerritoryCollection;
  municipalities: TerritoryCollection;
}

export type Bounds = [number, number, number, number];

export function bboxOf(features: TerritoryFeature[]): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (p: Position) => {
    if (p[0] < w) w = p[0];
    if (p[0] > e) e = p[0];
    if (p[1] < s) s = p[1];
    if (p[1] > n) n = p[1];
  };
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") g.coordinates.forEach((r) => r.forEach(visit));
    else g.coordinates.forEach((poly) => poly.forEach((r) => r.forEach(visit)));
  }
  return [w, s, e, n];
}

function isCollection(x: unknown): x is TerritoryCollection {
  const fc = x as TerritoryCollection;
  return (
    !!fc &&
    fc.type === "FeatureCollection" &&
    Array.isArray(fc.features) &&
    fc.features.length > 0 &&
    fc.features.every(
      (f) =>
        f &&
        typeof f.id === "number" &&
        !!f.properties?.code &&
        (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"),
    )
  );
}

export type GeoStatus = "loading" | "ready" | "error" | "unsupported";

export async function loadTerritoryGeo(fetcher: typeof fetch = fetch): Promise<TerritoryGeo> {
  const responses = await Promise.all([fetcher(UF_MESH_URL), ...Object.values(MUNICIPALITY_MESHES).map((u) => fetcher(u))]);
  if (responses.some((r) => !r.ok)) throw new Error("geo: malha indisponível");
  const [ufs, ...meshes] = (await Promise.all(responses.map((r) => r.json()))) as unknown[];
  if (!isCollection(ufs) || !meshes.every(isCollection)) throw new Error("geo: malha inválida");
  return {
    ufs,
    municipalities: { type: "FeatureCollection", features: (meshes as TerritoryCollection[]).flatMap((m) => m.features) },
  };
}

/** Território enquadrado em cada nível (códigos IBGE; sem malha ⇒ nível acima). */
export function boundsForLevel(
  geo: TerritoryGeo,
  level: ExplorerLevel,
  codes: { state: string | null; municipality: string | null },
): Bounds {
  const country = bboxOf(geo.ufs.features);
  if (level === "country" || codes.state == null) return country;
  const state = geo.ufs.features.filter((f) => f.properties.code === codes.state);
  const stateBounds = state.length ? bboxOf(state) : country;
  if (level === "state" || codes.municipality == null) return stateBounds;
  const municipality = geo.municipalities.features.filter((f) => f.properties.code === codes.municipality);
  return municipality.length ? bboxOf(municipality) : stateBounds;
}
