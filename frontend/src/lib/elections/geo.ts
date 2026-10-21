import type { ExplorerLevel } from "./route";

/**
 * Malhas territoriais oficiais (IBGE, API de malhas v3, qualidade "minima"),
 * geradas por scripts/fetch-ibge-geo.mjs em /public/geo (proveniência e SHA-256
 * em /public/geo/meta.json). IBGE = geografia; TSE = eleição, zona, seção, voto.
 * Bounds de câmera vêm SEMPRE da geometria oficial — nunca digitados à mão.
 */
export const UF_MESH_URL = "/geo/br-uf.json";

/** Siglas pelo código IBGE da UF (2 dígitos). */
const UF_SIGLA: Readonly<Record<string, string>> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/**
 * Malha municipal de cada UF, por código IBGE da UF: as 27 estão publicadas e
 * cada uma só é baixada quando a UF entra em cena. Ter malha não significa ter
 * dado carregado: a malha serve para navegar e identificar o território.
 */
export const MUNICIPALITY_MESHES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UF_SIGLA).map(([code, sigla]) => [code, `/geo/municipios/${sigla}.json`]),
);

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

const EMPTY: TerritoryCollection = { type: "FeatureCollection", features: [] };

// Uma requisição por arquivo durante a vida da página; falha não fica em cache (tentar de novo refaz).
const cache = new Map<string, Promise<TerritoryCollection>>();

function loadCollection(url: string, fetcher: typeof fetch): Promise<TerritoryCollection> {
  const hit = cache.get(url);
  if (hit) return hit;
  const request = (async () => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error("geo: malha indisponível");
    const body: unknown = await response.json();
    if (!isCollection(body)) throw new Error("geo: malha inválida");
    return body;
  })();
  cache.set(url, request);
  request.catch(() => cache.delete(url));
  return request;
}

/** Só para testes: esquece as malhas já baixadas. */
export function resetGeoCache() {
  cache.clear();
}

/** Malha das 27 UFs. */
export function loadUfMesh(fetcher: typeof fetch = fetch): Promise<TerritoryCollection> {
  return loadCollection(UF_MESH_URL, fetcher);
}

/** Malha municipal de uma UF (código IBGE de 2 dígitos); vazia se a UF não existe. */
export function loadMunicipalityMesh(stateCode: string, fetcher: typeof fetch = fetch): Promise<TerritoryCollection> {
  const url = MUNICIPALITY_MESHES[stateCode];
  return url ? loadCollection(url, fetcher) : Promise.resolve(EMPTY);
}

/** UFs e, se pedidos, os municípios das UFs indicadas (códigos IBGE de 2 dígitos). */
export async function loadTerritoryGeo(fetcher: typeof fetch = fetch, states: readonly string[] = []): Promise<TerritoryGeo> {
  const [ufs, ...meshes] = await Promise.all([loadUfMesh(fetcher), ...states.map((code) => loadMunicipalityMesh(code, fetcher))]);
  return { ufs, municipalities: mergeCollections(meshes) };
}

/** Junta malhas municipais sem repetir feições (o id é o código IBGE). */
export function mergeCollections(collections: readonly TerritoryCollection[]): TerritoryCollection {
  const seen = new Set<number>();
  const features: TerritoryFeature[] = [];
  for (const collection of collections)
    for (const feature of collection.features) {
      if (seen.has(feature.id)) continue;
      seen.add(feature.id);
      features.push(feature);
    }
  return { type: "FeatureCollection", features };
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
