import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { MAP_CHROME, SEQUENTIAL, type DataTheme } from "@/lib/dataviz/palette";
import { insidePoint } from "@/lib/territory/centroid";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { paintTransition, type PaintRole } from "@/motion/map";

/**
 * Peças do mapa territorial sobre o MapLibre, sem React. Camadas de baixo para cima:
 * terra de contexto → duas camadas de cor por fonte (A/B, para a transição cruzada) → relevo → calor →
 * fronteiras → véus (holofote) → contorno de hover → contorno revelado da seleção → pulso.
 * Cor de interação = teal da marca (MAP_CHROME.selection), nunca cor de dado.
 */

export type Slot = "a" | "b";
export type SourceId = "ufs" | "mun";

/** Opacidade do véu: hover (realce leve), contexto (resto do Brasil) e holofote (município escolhido). */
export const VEIL = { hover: 0.3, context: 0.5, spotlight: 0.55 } as const;

const EMPTY = { type: "FeatureCollection", features: [] } as const;

export function webglAvailable(): boolean {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Tema resolvido no instante da criação (o efeito de tema repinta depois). */
export const currentTheme = (): DataTheme =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export const styleFor = (theme: DataTheme): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": MAP_CHROME[theme].background } }],
});

const slotColor = (slot: Slot, theme: DataTheme): ExpressionSpecification => [
  "to-color",
  ["coalesce", ["feature-state", slot], MAP_CHROME[theme].land],
];

/** Rampa do calor: transparente onde não há densidade e, no escuro, clareando (mais forte = mais claro). */
const HEAT_STOPS: Record<DataTheme, string[]> = {
  light: ["rgba(205,226,251,0.55)", "rgba(57,135,229,0.75)", SEQUENTIAL.light.high],
  dark: ["rgba(158,197,244,0.3)", "rgba(158,197,244,0.65)", "#e6f0fc"],
};

const heatRamp = (theme: DataTheme): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["heatmap-density"],
  0,
  "rgba(0,0,0,0)",
  0.08,
  HEAT_STOPS[theme][0],
  0.5,
  HEAT_STOPS[theme][1],
  1,
  HEAT_STOPS[theme][2],
];

const NONE: FilterSpecification = ["==", ["id"], -1];

/** Pontos internos (calculados da malha oficial) de cada território: pulso e calor. */
export function pointsOf(collection: TerritoryCollection) {
  return {
    type: "FeatureCollection" as const,
    features: collection.features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      properties: { code: f.properties.code },
      geometry: { type: "Point" as const, coordinates: insidePoint(f.geometry) },
    })),
  };
}

/** Fontes e camadas. `compare` = mapa "antes" do divisor: só terra, cor e fronteiras. */
export function addTerritoryLayers(map: MapLibreMap, theme: DataTheme, ufs: TerritoryCollection, compare = false) {
  const c = MAP_CHROME[theme];
  map.addSource("ufs", { type: "geojson", data: ufs as never });
  map.addSource("mun", { type: "geojson", data: EMPTY as never });
  map.addLayer({ id: "ufs-context", type: "fill", source: "ufs", paint: { "fill-color": c.land } });
  for (const source of ["ufs", "mun"] as const)
    for (const slot of ["a", "b"] as const)
      map.addLayer({ id: `${source}-${slot}`, type: "fill", source, paint: { "fill-color": slotColor(slot, theme), "fill-opacity": 0 } });
  if (!compare) {
    map.addSource("pts", { type: "geojson", data: EMPTY as never });
    map.addLayer({
      id: "mun-extrude",
      type: "fill-extrusion",
      source: "mun",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": slotColor("a", theme),
        "fill-extrusion-height": ["coalesce", ["feature-state", "h"], 0],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0,
      },
    });
    map.addLayer({
      id: "heat",
      type: "heatmap",
      source: "pts",
      paint: {
        "heatmap-weight": ["coalesce", ["feature-state", "w"], 0],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 7, 32, 10, 56],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 10, 2.6],
        "heatmap-color": heatRamp(theme),
        "heatmap-opacity": 0,
      },
    });
  }
  map.addLayer({ id: "ufs-line", type: "line", source: "ufs", paint: { "line-color": c.border, "line-opacity": c.borderOpacity, "line-width": 1 } });
  map.addLayer({ id: "mun-line", type: "line", source: "mun", paint: { "line-color": c.border, "line-opacity": c.borderOpacity * 0.8, "line-width": 0.6 } });
  for (const source of ["ufs", "mun"] as const) {
    map.addLayer({ id: `${source}-veil`, type: "fill", source, filter: NONE, paint: { "fill-color": c.background, "fill-opacity": 0 } });
  }
  if (compare) {
    // o lado "antes" mostra o mesmo holofote e o mesmo contorno, sem hover nem efeitos de chegada
    map.addLayer({ id: "ufs-outline", type: "line", source: "ufs", filter: NONE, paint: { "line-color": c.selection, "line-width": 2, "line-opacity": 1 } });
    map.addLayer({ id: "mun-outline", type: "line", source: "mun", filter: NONE, paint: { "line-color": c.selection, "line-width": 2.5, "line-opacity": 1 } });
    return;
  }
  for (const source of ["ufs", "mun"] as const) {
    map.addLayer({
      id: `${source}-hover`,
      type: "line",
      source,
      paint: {
        "line-color": c.selection,
        "line-width": 1.6,
        "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
      },
    });
    map.addLayer({ id: `${source}-outline`, type: "line", source, filter: NONE, paint: { "line-color": c.selection, "line-width": 0, "line-opacity": 0 } });
  }
  map.addLayer({
    id: "pulse",
    type: "circle",
    source: "pts",
    filter: NONE,
    paint: {
      "circle-radius": 0,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": SEQUENTIAL[theme].high,
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": 0,
    },
  });
}

/** Repinta o cromo no tema atual sem remontar o mapa. A cor dos dados chega em nova camada (já no tema). */
export function applyChrome(map: MapLibreMap, theme: DataTheme, activeSlot: Slot) {
  const c = MAP_CHROME[theme];
  const set = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never);
  };
  set("background", "background-color", c.background);
  set("ufs-context", "fill-color", c.land);
  for (const source of ["ufs", "mun"] as const) {
    for (const slot of ["a", "b"] as const) set(`${source}-${slot}`, "fill-color", slotColor(slot, theme));
    set(`${source}-line`, "line-color", c.border);
    set(`${source}-veil`, "fill-color", c.background);
    set(`${source}-hover`, "line-color", c.selection);
    set(`${source}-outline`, "line-color", c.selection);
  }
  set("ufs-line", "line-opacity", c.borderOpacity);
  set("mun-line", "line-opacity", c.borderOpacity * 0.8);
  set("mun-extrude", "fill-extrusion-color", slotColor(activeSlot, theme));
  set("heat", "heatmap-color", heatRamp(theme));
  set("pulse", "circle-stroke-color", SEQUENTIAL[theme].high);
}

/** Muda uma propriedade de pintura com a transição do papel indicado (Reduced Motion = imediato). */
export function paint(map: MapLibreMap, layer: string, prop: string, value: unknown, role: PaintRole | null, reduced: boolean, delay = 0) {
  if (!map.getLayer(layer)) return;
  map.setPaintProperty(layer, `${prop}-transition` as never, (role ? paintTransition(role, reduced, delay) : { duration: 0, delay: 0 }) as never);
  map.setPaintProperty(layer, prop as never, value as never);
}

export const onlyId = (id: number | null): FilterSpecification => (id == null ? NONE : ["==", ["id"], id]);
/** Todos menos `id` (sem id: todos — `["all"]` vazio é verdadeiro). */
export const exceptId = (id: number | null): FilterSpecification => (id == null ? ["all"] : ["!=", ["id"], id]);
export const anyId = (ids: number[]): FilterSpecification => (ids.length ? ["in", ["id"], ["literal", ids]] : NONE);

export function setCollection(map: MapLibreMap, source: string, data: unknown) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data as never);
}

export const slotColorExpression = slotColor;
export const emptyCollection = EMPTY;
