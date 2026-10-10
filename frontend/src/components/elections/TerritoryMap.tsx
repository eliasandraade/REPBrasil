"use client";

import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { bboxOf, boundsForLevel, loadTerritoryGeo, type GeoStatus, type TerritoryGeo } from "@/lib/elections/geo";
import type { ExplorerLevel } from "@/lib/elections/route";
import { duration, easingFn } from "@/motion/tokens";

const SURVEY_EASING = easingFn("traverse");

/**
 * Mapa territorial persistente do explorador (MapLibre). Uma única instância
 * vive entre Brasil → UF → município → zona → seção: troca de nível muda
 * filtros, visibilidade e feature-state, nunca remonta.
 *
 * - Cores neutras do REPBrasil (sem cor partidária): destaque = dados
 *   disponíveis, nunca vencedor.
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

const fillPaint = {
  "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], COLORS.highlight, COLORS.land],
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

export function TerritoryMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const geoRef = useRef<TerritoryGeo | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const selected = useRef<Array<{ source: string; id: number }>>([]);
  const hovered = useRef<{ source: string; id: number } | null>(null);
  const [status, setStatus] = useState<GeoStatus>("loading");

  // Criação única.
  useEffect(() => {
    if (!webglAvailable()) {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    // Erros de carga já viram status "error"; a promise não tem consumidor.
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
      // Worker publicado por scripts/copy-maplibre-worker.mjs (predev/prebuild).
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

        const interactive = (target: "state" | "municipality") =>
          new Set((target === "state" ? latest.current.scope.interactiveStates : latest.current.scope.interactiveMunicipalities).map(Number));
        const bind = (layer: string, source: string, target: "state" | "municipality") => {
          const hit = (e: MapLayerMouseEvent) => e.features?.find((f) => interactive(target).has(Number(f.id)));
          map.on("mousemove", layer, (e) => {
            const f = hit(e);
            setHover(f ? { source, id: Number(f.id) } : null);
          });
          map.on("mouseleave", layer, () => setHover(null));
          map.on("click", layer, (e) => {
            const f = hit(e);
            if (f) latest.current.onSelect(target, String(f.id));
          });
        };
        const setHover = (next: { source: string; id: number } | null) => {
          const prev = hovered.current;
          if (prev && (prev.id !== next?.id || prev.source !== next?.source)) map.setFeatureState(prev, { hover: false });
          if (next) map.setFeatureState(next, { hover: true });
          hovered.current = next;
          map.getCanvas().style.cursor = next ? "pointer" : "";
        };
        bind("uf-fill", "ufs", "state");
        bind("mun-fill", "mun", "municipality");
        map.on("click", "place-points", (e) => {
          const code = e.features?.[0]?.properties?.code;
          if (typeof code === "string") latest.current.onSelectPlace(code);
        });
        map.on("mouseenter", "place-points", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "place-points", () => (map.getCanvas().style.cursor = ""));
        setStatus("ready");
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Escopo → destaque (dados disponíveis) e visibilidade por nível.
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
    // scopeKey resume o escopo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, scopeKey, props.level]);

  // Pontos oficiais dos locais (vazio quando a fonte não publica coordenadas).
  const pointsKey = props.points.map((p) => p.code).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    // Locais surgem depois que a câmera assenta sobre a zona (consequência da escolha, não explosão).
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
    // pointsKey resume os pontos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pointsKey]);

  // Rota → câmera (sem animação com Reduced Motion).
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
    // a rota define o enquadramento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.routeKey, props.scope.state, props.scope.municipality]);

  return (
    <div className="relative h-full min-h-[280px] w-full overflow-hidden rounded-xl border border-white/8 bg-background">
      <div ref={container} className="absolute inset-0" data-testid="territory-map" role="region" aria-label="Mapa territorial" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-slate-500">
          {status === "loading" && "Carregando malha territorial oficial (IBGE)…"}
          {status === "error" && "Malha territorial indisponível. A navegação pelas listas continua funcionando."}
          {status === "unsupported" && "Mapa indisponível neste navegador (WebGL). A navegação pelas listas continua funcionando."}
        </div>
      )}
      <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-slate-600">Malhas: IBGE · Locais: TSE (só coordenadas oficiais)</p>
    </div>
  );
}
