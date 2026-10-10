"use client";

import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { bboxOf, boundsForLevel, loadTerritoryGeo, type GeoStatus, type TerritoryGeo } from "@/lib/elections/geo";
import type { MapLayerView } from "@/lib/elections/map-layers";
import type { ExplorerLevel } from "@/lib/elections/route";
import { duration, easingFn } from "@/motion/tokens";

const SURVEY_EASING = easingFn("traverse");

/**
 * Mapa territorial persistente do explorador (MapLibre). Uma única instância
 * vive entre Brasil → UF → município → zona → seção: troca de nível muda
 * filtros, visibilidade e feature-state, nunca remonta.
 *
 * - Cores neutras do REPBrasil (sem cor partidária): destaque = dados
 *   disponíveis. Camadas temáticas (intensidade, crescimento, A × B,
 *   mais votado…) colorem pelo VALOR da API, com paleta neutra.
 * - Pontos SÓ para locais com coordenada publicada pela fonte oficial.
 * - Reduced Motion: câmera sem animação.
 * - Sem WebGL ou sem malha: o explorador segue pelas listas.
 */

export interface MapScope {
  state: string | null;
  municipality: string | null;
  interactiveStates: string[];
  highlightStates: string[];
  interactiveMunicipalities: string[];
  highlightMunicipalities: string[];
}

export interface MapPoint {
  code: string;
  latitude: number;
  longitude: number;
}

type Props = {
  level: ExplorerLevel;
  routeKey: string;
  scope: MapScope;
  points: MapPoint[];
  reduced: boolean;
  onSelect: (target: "state" | "municipality", ibgeCode: string) => void;
  onSelectPlace: (code: string) => void;
  /** Camada temática opcional (valores da API, cores já resolvidas). */
  layer?: MapLayerView | null;
};

const COLORS = {
  base: "#0a0f16",
  land: "#16212f",
  highlight: "#123b33",
  border: "#e2e8f0",
  accent: "#0dd48e",
  point: "#0d1520",
  pointStroke: "#38e8b0",
} as const;

const STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": COLORS.base } }],
};

// Cor temática (feature-state "color") tem precedência; sem camada, destaque de disponibilidade.
const fillPaint = {
  "fill-color": [
    "to-color",
    ["coalesce", ["feature-state", "color"], ["case", ["boolean", ["feature-state", "selected"], false], COLORS.highlight, COLORS.land]],
  ],
  "fill-opacity": 1,
} as const;
const linePaint = { "line-color": COLORS.border, "line-opacity": 0.14, "line-width": 1 } as const;
const focusPaint = {
  "line-color": COLORS.accent,
  "line-width": 1.5,
  "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
} as const;

function webglAvailable() {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Assinatura estável da camada temática (muda só quando cores ou feições mudam). */
function layerSignature(layer: MapLayerView | null | undefined): string {
  if (!layer) return "";
  const municipalities = Object.entries(layer.municipalities).map(([k, v]) => k + ":" + v.color);
  const places = layer.places.map((p) => p.key + ":" + p.color);
  return [layer.kind, layer.level, municipalities.join(","), places.join(",")].join("|");
}

export function TerritoryMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const geoRef = useRef<TerritoryGeo | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const selected = useRef<Array<{ source: string; id: number }>>([]);
  const colored = useRef<number[]>([]);
  const hovered = useRef<{ source: string; id: number } | null>(null);
  const [status, setStatus] = useState<GeoStatus>("loading");

  useEffect(() => {
    if (!webglAvailable()) {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    void (async () => {
      let geo: TerritoryGeo;
      try {
        geo = await loadTerritoryGeo();
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      maplibre.setWorkerUrl(`/maplibre/worker-${maplibre.getVersion()}.mjs`);
      geoRef.current = geo;
      const map = new maplibre.Map({
        container: container.current,
        style: STYLE,
        bounds: bboxOf(geo.ufs.features),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        fadeDuration: 0,
        maxZoom: 15,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("ufs", { type: "geojson", data: geo.ufs as never });
        map.addSource("mun", { type: "geojson", data: geo.municipalities as never });
        map.addSource("layer-places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("places", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 36,
          clusterMaxZoom: 14,
        });
        map.addLayer({ id: "uf-fill", type: "fill", source: "ufs", paint: fillPaint as never });
        map.addLayer({ id: "uf-line", type: "line", source: "ufs", paint: linePaint });
        map.addLayer({ id: "uf-focus", type: "line", source: "ufs", paint: focusPaint as never });
        map.addLayer({ id: "mun-fill", type: "fill", source: "mun", paint: fillPaint as never, layout: { visibility: "none" } });
        map.addLayer({ id: "mun-line", type: "line", source: "mun", paint: linePaint, layout: { visibility: "none" } });
        map.addLayer({ id: "mun-focus", type: "line", source: "mun", paint: focusPaint as never, layout: { visibility: "none" } });
        map.addLayer({
          id: "place-clusters",
          type: "circle",
          source: "places",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": COLORS.point,
            "circle-radius": 16,
            "circle-stroke-color": COLORS.pointStroke,
            "circle-stroke-width": 1,
            "circle-opacity-transition": { duration: duration.traverse, delay: 0 },
            "circle-stroke-opacity-transition": { duration: duration.traverse, delay: 0 },
          },
        });
        map.addLayer({
          id: "place-points",
          type: "circle",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": COLORS.point,
            "circle-radius": 7,
            "circle-stroke-color": COLORS.pointStroke,
            "circle-stroke-width": 1.5,
            "circle-opacity-transition": { duration: duration.traverse, delay: 0 },
            "circle-stroke-opacity-transition": { duration: duration.traverse, delay: 0 },
          },
        });

        map.addLayer({
          id: "layer-place-points",
          type: "circle",
          source: "layer-places",
          paint: {
            "circle-color": ["to-color", ["get", "color"]],
            "circle-radius": 6,
            "circle-stroke-color": COLORS.base,
            "circle-stroke-width": 1,
          },
        });

        const interactive = (target: "state" | "municipality") =>
          new Set((target === "state" ? latest.current.scope.interactiveStates : latest.current.scope.interactiveMunicipalities).map(Number));
        const hideTooltip = () => {
          if (tooltip.current) tooltip.current.style.opacity = "0";
        };
        // Nome do território (e valor da camada, quando há) segue o ponteiro. Só texto: nunca HTML.
        const showTooltip = (e: MapLayerMouseEvent, name: unknown, detail?: string) => {
          if (!tooltip.current || typeof name !== "string" || !name.trim()) {
            hideTooltip();
            return;
          }
          const title = document.createElement("span");
          title.className = "block";
          title.textContent = name;
          const parts: HTMLElement[] = [title];
          if (detail) {
            const line = document.createElement("span");
            line.className = "block font-normal text-slate-400";
            line.textContent = detail;
            parts.push(line);
          }
          tooltip.current.replaceChildren(...parts);
          tooltip.current.style.transform = `translate3d(${e.point.x + 12}px, ${e.point.y + 12}px, 0)`;
          tooltip.current.style.opacity = "1";
        };
        const setHover = (next: { source: string; id: number } | null, selectable = false) => {
          const prev = hovered.current;
          if (prev && (prev.id !== next?.id || prev.source !== next?.source)) map.setFeatureState(prev, { hover: false });
          if (next) map.setFeatureState(next, { hover: true });
          hovered.current = next;
          map.getCanvas().style.cursor = selectable ? "pointer" : "";
        };
        const bind = (layer: string, source: string, target: "state" | "municipality") => {
          const selectable = (e: MapLayerMouseEvent) => e.features?.find((f) => interactive(target).has(Number(f.id)));
          map.on("mousemove", layer, (e) => {
            const feature = e.features?.[0];
            if (feature?.id == null) {
              setHover(null);
              hideTooltip();
              return;
            }
            const canSelect = interactive(target).has(Number(feature.id));
            setHover({ source, id: Number(feature.id) }, canSelect);
            const layerValue = target === "municipality" ? latest.current.layer?.municipalities[String(feature.id)] : undefined;
            showTooltip(e, feature.properties?.name, layerValue?.text);
          });
          map.on("mouseleave", layer, () => {
            setHover(null);
            hideTooltip();
          });
          map.on("click", layer, (e) => {
            const feature = selectable(e);
            if (feature) latest.current.onSelect(target, String(feature.id));
          });
        };
        bind("uf-fill", "ufs", "state");
        bind("mun-fill", "mun", "municipality");
        map.on("click", "place-points", (e) => {
          const code = e.features?.[0]?.properties?.code;
          if (typeof code === "string") latest.current.onSelectPlace(code);
        });
        map.on("mouseenter", "place-points", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "place-points", () => (map.getCanvas().style.cursor = ""));
        map.on("mousemove", "layer-place-points", (e) => {
          const f = e.features?.[0];
          showTooltip(e, f?.properties?.name, typeof f?.properties?.text === "string" ? f.properties.text : undefined);
        });
        map.on("mouseleave", "layer-place-points", hideTooltip);
        setStatus("ready");
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const scopeKey = JSON.stringify(props.scope);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const s = props.scope;
    for (const sel of selected.current) map.setFeatureState(sel, { selected: false });
    const states = new Set([...s.highlightStates, ...(s.state ? [s.state] : [])]);
    const muns = new Set([...s.highlightMunicipalities, ...(s.municipality ? [s.municipality] : [])]);
    selected.current = [
      ...[...states].map((c) => ({ source: "ufs", id: Number(c) })),
      ...[...muns].map((c) => ({ source: "mun", id: Number(c) })),
    ];
    for (const sel of selected.current) map.setFeatureState(sel, { selected: true });

    const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    const country = props.level === "country";
    vis(["uf-fill", "uf-line", "uf-focus"], country);
    vis(["mun-fill", "mun-line", "mun-focus"], !country);
    const only = props.level === "state" || s.municipality == null ? null : (["==", ["id"], Number(s.municipality)] as never);
    ["mun-fill", "mun-line", "mun-focus"].forEach((id) => map.setFilter(id, only));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, scopeKey, props.level]);

  // Camada temática: cor por município (feature-state) e pontos por local de votação.
  const layerKey = layerSignature(props.layer);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    for (const id of colored.current) map.setFeatureState({ source: "mun", id }, { color: null });
    const entries = Object.entries(props.layer?.municipalities ?? {}).filter(([, v]) => v.color);
    for (const [id, v] of entries) map.setFeatureState({ source: "mun", id: Number(id) }, { color: v.color });
    colored.current = entries.map(([id]) => Number(id));
    (map.getSource("layer-places") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (props.layer?.places ?? [])
        .filter((p) => p.color)
        .map((p) => ({
          type: "Feature",
          properties: { name: p.name, text: p.text, color: p.color },
          geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, layerKey]);

  const pointsKey = props.points.map((p) => p.code).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const layers = ["place-points", "place-clusters"];
    if (!props.reduced && props.points.length > 0) {
      for (const id of layers) {
        map.setPaintProperty(id, "circle-opacity", 0);
        map.setPaintProperty(id, "circle-stroke-opacity", 0);
      }
      map.once("idle", () => {
        for (const id of layers) {
          map.setPaintProperty(id, "circle-opacity", 1);
          map.setPaintProperty(id, "circle-stroke-opacity", 1);
        }
      });
    } else {
      for (const id of layers) {
        map.setPaintProperty(id, "circle-opacity", 1);
        map.setPaintProperty(id, "circle-stroke-opacity", 1);
      }
    }
    (map.getSource("places") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: props.points.map((p) => ({
        type: "Feature",
        properties: { code: p.code },
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pointsKey]);

  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (status !== "ready" || !map || !geo) return;
    const [w, s, e, n] = boundsForLevel(geo, props.level, { state: props.scope.state, municipality: props.scope.municipality });
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 32, duration: props.reduced ? 0 : duration.survey, easing: SURVEY_EASING, maxZoom: props.level === "country" ? 5 : 13 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.routeKey, props.scope.state, props.scope.municipality]);

  return (
    <div className="relative h-full min-h-[280px] w-full overflow-hidden rounded-xl border border-white/8 bg-background">
      <div ref={container} className="absolute inset-0" data-testid="territory-map" role="region" aria-label="Mapa territorial" />
      <div
        ref={tooltip}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-[220px] rounded-md border border-white/10 bg-slate-950/95 px-2 py-1 text-xs font-medium text-slate-100 opacity-0 shadow-lg transition-opacity motion-reduce:transition-none"
        data-testid="territory-hover-label"
      />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-slate-500">
          {status === "loading" && "Carregando malha territorial oficial (IBGE)…"}
          {status === "error" && "Malha territorial indisponível. A navegação pelas listas continua funcionando."}
          {status === "unsupported" && "Mapa indisponível neste navegador (WebGL). A navegação pelas listas continua funcionando."}
        </div>
      )}
      {props.layer && (props.layer.legend.length > 0 || props.layer.gradient) && (
        <div className="pointer-events-none absolute bottom-6 right-3 z-10 max-w-[240px] rounded-md border border-white/10 bg-slate-950/90 px-2.5 py-2 text-[10px] text-slate-300" data-testid="map-legend">
          {props.layer.gradient && (
            <div>
              <div className="h-1.5 w-40 rounded" style={{ background: `linear-gradient(90deg, ${props.layer.gradient.from}, ${props.layer.gradient.to})` }} />
              <div className="mt-0.5 flex justify-between text-slate-500">
                <span>{props.layer.gradient.min}</span>
                <span>{props.layer.gradient.max}</span>
              </div>
            </div>
          )}
          {props.layer.legend.slice(0, 8).map((l) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: l.color }} />
              <span className="truncate">{l.label}</span>
            </div>
          ))}
        </div>
      )}
      <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-slate-600">Malhas: IBGE · Locais: TSE (só coordenadas oficiais)</p>
    </div>
  );
}
