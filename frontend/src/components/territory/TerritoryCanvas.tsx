"use client";

import type { Map as MapLibreMap, MapMouseEvent, PointLike } from "maplibre-gl";
import { useEffect, useId, useRef, useState } from "react";
import { useResolvedTheme } from "@/components/theme/theme";
import { RetryButton } from "@/components/ui/DataState";
import type { DataTheme } from "@/lib/dataviz/palette";
import { bboxOf, loadMunicipalityMesh, loadUfMesh, type Bounds, type TerritoryCollection, type TerritoryFeature } from "@/lib/elections/geo";
import { insidePoint } from "@/lib/territory/centroid";
import { canvasSignature, viewNote, type CanvasLayer } from "@/lib/territory/layers";
import { placeTooltip, type Box } from "@/lib/territory/tooltip";
import type { ExplorerLevel, ExplorerView } from "@/lib/territory/url";
import { cameraMotion, pulseMotion, PULSE_TOP, RELIEF_PITCH } from "@/motion/map";
import { duration } from "@/motion/tokens";
import {
  VEIL,
  addTerritoryLayers,
  anyId,
  applyChrome,
  currentTheme,
  emptyCollection,
  exceptId,
  onlyId,
  paint,
  pointsOf,
  setCollection,
  slotColorExpression,
  styleFor,
  webglAvailable,
  type Slot,
  type SourceId,
} from "./engine";
import { MapLegend } from "./MapLegend";

/**
 * Mapa territorial do explorador (/dados). Uma instância persistente de Brasil → UF → município: a troca de nível,
 * de modo ou de recorte muda câmera, filtros e feature-state, nunca remonta.
 *
 * Efeitos, todos ligados a dado real: transição cruzada entre camadas (A/B), holofote no território escolhido e
 * véu sobre o resto, contorno revelado da seleção, câmera Brasil → UF → município, rótulo que respeita a área do
 * mapa e a seleção, relevo 3D proporcional ao valor, mapa de calor e pulso único só para grandezas somáveis, e
 * antes/depois com divisor acessível por teclado. Reduced Motion: corte seco, sem pulso.
 * Sem WebGL ou sem malha, a tabela da página continua com os mesmos dados.
 */

type Status = "loading" | "ready" | "error" | "unsupported";

export interface CompareSide {
  layer: CanvasLayer;
  label: string;
}

export interface TerritoryCanvasProps {
  level: ExplorerLevel;
  /** Código IBGE (2 dígitos) da UF em cena. */
  stateCode: string | null;
  /** Código IBGE (7 dígitos) do município escolhido. */
  municipality: string | null;
  layer: CanvasLayer | null;
  view: ExplorerView;
  /** Lado "antes" do divisor (vista comparar). */
  before?: CompareSide | null;
  afterLabel?: string;
  /** Território destacado de fora (hover na tabela). */
  hovered: string | null;
  onHover: (code: string | null) => void;
  onSelect: (target: "state" | "municipality", code: string) => void;
  reduced: boolean;
  /** Relevo 3D permitido (ponteiro fino e tela larga). */
  allowRelief: boolean;
  label: string;
}

interface SlotState {
  active: Slot;
  ids: Record<Slot, number[]>;
  sig: Record<Slot, string>;
}

interface Mesh {
  state: string;
  collection: TerritoryCollection;
  byId: Map<number, TerritoryFeature>;
}

interface Hit {
  source: SourceId;
  id: number;
  name: string;
}

/** Aproximação máxima por nível: o município escolhido aparece com os vizinhos em volta. */
const MAX_ZOOM: Record<ExplorerLevel, number> = { country: 4.8, state: 9, municipality: 9.8 };

/** Na intensidade, a cor das classes recua para o calor ser lido. */
const HEAT_FILL = 0.12;

const freshSlot = (): SlotState => ({ active: "a", ids: { a: [], b: [] }, sig: { a: "", b: "" } });

/** Textos dos gestos cooperativos do MapLibre, em português. */
const GESTURE_TEXT = {
  "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + rolagem para aproximar ou afastar o mapa",
  "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + rolagem para aproximar ou afastar o mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Use dois dedos para mover o mapa",
};

const CONTROL =
  "focus-ring flex h-8 w-8 items-center justify-center text-sm font-semibold text-fg-soft hover:bg-fg/10 hover:text-fg [&+button]:border-t [&+button]:border-line";

const reliefOn = (p: TerritoryCanvasProps) =>
  p.view === "relevo" && p.allowRelief && p.level !== "country" && p.layer?.level === "state" && Object.keys(p.layer.magnitudes).length > 0;
const heatOn = (p: TerritoryCanvasProps) => p.view === "intensidade" && p.level !== "country" && p.layer?.level === "state" && p.layer.extensive;
const compareOn = (p: TerritoryCanvasProps) => p.view === "comparar" && !!p.before;

/** A vista que o mapa realmente desenha (relevo e calor dependem do dado e do nível). */
function drawnView(p: TerritoryCanvasProps): ExplorerView {
  if (reliefOn(p)) return "relevo";
  if (heatOn(p)) return "intensidade";
  return compareOn(p) ? "comparar" : "mapa";
}

export function TerritoryCanvas(props: TerritoryCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const compareHost = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const compareRef = useRef<MapLibreMap | null>(null);
  const ufsRef = useRef<TerritoryCollection | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const slots = useRef<Record<SourceId, SlotState>>({ ufs: freshSlot(), mun: freshSlot() });
  const compareColored = useRef<{ source: SourceId; ids: number[] }>({ source: "ufs", ids: [] });
  const hover = useRef<Hit | null>(null);
  const hoverFromOutside = useRef(false);
  const revealed = useRef<Record<string, number | null>>({});
  const interacted = useRef(false);
  /** Inclinação já pedida à câmera (o MapLibre não expõe o destino de um voo em curso). */
  const pitchTarget = useRef(0);
  const themeRef = useRef<DataTheme>("light");
  const splitRef = useRef(50);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<Status>("loading");
  const [meshState, setMeshState] = useState<string | null>(null);
  const [meshFailed, setMeshFailed] = useState<string | null>(null);
  const [meshAttempt, setMeshAttempt] = useState(0);
  const [compareReady, setCompareReady] = useState(false);
  const [split, setSplit] = useState(50);
  splitRef.current = split;
  const theme = useResolvedTheme();
  const descriptionId = useId();

  // ── geometria e câmera ──────────────────────────────────────────────────────

  /** Malha da UF em cena. A da UF anterior continua na tela durante a troca, mas não responde nem recebe cor. */
  const sceneMesh = (p: TerritoryCanvasProps): Mesh | null =>
    p.level !== "country" && meshRef.current?.state === p.stateCode ? meshRef.current : null;

  const targetBounds = (p: TerritoryCanvasProps): Bounds | null => {
    const ufs = ufsRef.current;
    if (!ufs) return null;
    if (p.level === "country" || !p.stateCode) return bboxOf(ufs.features);
    if (p.level === "municipality" && p.municipality) {
      const feature = meshRef.current?.byId.get(Number(p.municipality));
      if (feature) return bboxOf([feature]);
    }
    const state = ufs.features.filter((f) => f.properties.code === p.stateCode);
    return bboxOf(state.length ? state : ufs.features);
  };

  const fit = (animate: boolean) => {
    const map = mapRef.current;
    const box = container.current;
    const p = latest.current;
    const bounds = targetBounds(p);
    if (!map || !box || !bounds) return;
    const narrow = box.clientWidth < 640;
    const padding = narrow ? { top: 20, right: 20, bottom: 20, left: 20 } : { top: 48, right: 64, bottom: 56, left: 40 };
    const maxZoom = MAX_ZOOM[p.level];
    const camera = map.cameraForBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding, maxZoom });
    if (!camera) return;
    const motion = cameraMotion(p.level === "municipality" ? "traverse" : "survey", p.reduced || !animate);
    const pitch = reliefOn(p) ? RELIEF_PITCH : 0;
    pitchTarget.current = pitch;
    map.easeTo({ ...camera, bearing: 0, pitch, duration: motion.duration, easing: motion.easing });
  };

  /** Caixa da seleção na tela: o rótulo evita cobri-la. */
  const selectionBox = (): Box | null => {
    const map = mapRef.current;
    const p = latest.current;
    if (!map || p.level !== "municipality" || !p.municipality) return null;
    const feature = meshRef.current?.byId.get(Number(p.municipality));
    if (!feature) return null;
    const [w, s, e, n] = bboxOf([feature]);
    const a = map.project([w, n]);
    const b = map.project([e, s]);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  };

  // ── rótulo (tooltip) ────────────────────────────────────────────────────────

  const hideTooltip = () => {
    if (tooltip.current) tooltip.current.style.opacity = "0";
  };

  const showTooltip = (point: { x: number; y: number }, hit: Hit) => {
    const el = tooltip.current;
    const box = container.current;
    if (!el || !box || !hit.name.trim()) return hideTooltip();
    const p = latest.current;
    let detail: string | null = null;
    let caption: string | null = null;
    if (hit.source === "ufs" && p.level !== "country") {
      detail = "Clique para explorar esta UF";
    } else {
      const left = compareOn(p) && point.x < (box.clientWidth * splitRef.current) / 100;
      const layer = left ? p.before!.layer : p.layer;
      if (layer && (layer.level === "country") === (hit.source === "ufs")) {
        detail = layer.texts[String(hit.id)] ?? "sem dado carregado";
        caption = layer.caption;
      }
    }
    // Só texto (textContent): nada vindo de dado vira HTML.
    const line = (text: string, className: string) => {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      return span;
    };
    el.replaceChildren(
      line(hit.name, "block font-semibold"),
      ...(detail ? [line(detail, "block")] : []),
      ...(caption ? [line(caption, "mt-0.5 block text-[10px] text-fg-muted")] : []),
    );
    el.style.opacity = "1";
    const placed = placeTooltip(point, { width: el.offsetWidth, height: el.offsetHeight }, { width: box.clientWidth, height: box.clientHeight }, selectionBox());
    el.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
  };

  // ── hover, véu e seleção ────────────────────────────────────────────────────

  const setHover = (next: Hit | null) => {
    const map = mapRef.current;
    if (!map) return;
    const prev = hover.current;
    if (prev && (prev.id !== next?.id || prev.source !== next?.source)) map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false });
    if (next) map.setFeatureState({ source: next.source, id: next.id }, { hover: true });
    hover.current = next;
    const p = latest.current;
    // véu de hover: no Brasil sobre as outras UFs, na UF sobre os outros municípios (no município o holofote é fixo)
    const veil = p.level === "country" ? "ufs" : p.level === "state" ? "mun" : null;
    if (!veil) return;
    const id = next?.source === veil ? next.id : null;
    map.setFilter(`${veil}-veil`, exceptId(id));
    paint(map, `${veil}-veil`, "fill-opacity", id == null ? 0 : VEIL.hover, "settle", p.reduced, id == null ? 0 : duration.acknowledge);
  };

  const hitAt = (map: MapLibreMap, point: PointLike): Hit | null => {
    const p = latest.current;
    if (sceneMesh(p)) {
      const mun = map.queryRenderedFeatures(point, { layers: ["mun-a"] })[0];
      if (mun?.id != null) return { source: "mun", id: Number(mun.id), name: String(mun.properties?.name ?? "") };
    }
    const uf = map.queryRenderedFeatures(point, { layers: ["ufs-context"] })[0];
    return uf?.id != null ? { source: "ufs", id: Number(uf.id), name: String(uf.properties?.name ?? "") } : null;
  };

  const onMove = (e: MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const hit = hitAt(map, e.point);
    const p = latest.current;
    hoverFromOutside.current = false;
    if (!hit) {
      if (hover.current) {
        setHover(null);
        p.onHover(null);
      }
      map.getCanvas().style.cursor = "";
      return hideTooltip();
    }
    if (hover.current?.id !== hit.id || hover.current.source !== hit.source) {
      setHover(hit);
      p.onHover(hit.source === "mun" || p.level === "country" ? String(hit.id) : null);
    }
    const selectable = hit.source === "mun" || p.level === "country" || String(hit.id) !== p.stateCode;
    map.getCanvas().style.cursor = selectable ? "pointer" : "";
    showTooltip(e.point, hit);
  };

  const onLeave = () => {
    if (hover.current) {
      setHover(null);
      latest.current.onHover(null);
    }
    hideTooltip();
  };

  const onClick = (e: MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const hit = hitAt(map, e.point);
    const p = latest.current;
    if (!hit) return;
    if (hit.source === "mun") p.onSelect("municipality", String(hit.id));
    else if (p.level === "country" || String(hit.id) !== p.stateCode) p.onSelect("state", String(hit.id));
  };

  /** Contorno que se traça na seleção (largura e opacidade com transição). */
  const reveal = (map: MapLibreMap, layer: string, id: number | null, width: number, reduced: boolean) => {
    if (revealed.current[layer] === id) return;
    revealed.current[layer] = id;
    map.setFilter(layer, onlyId(id));
    paint(map, layer, "line-width", 0, null, true);
    paint(map, layer, "line-opacity", 0, null, true);
    if (id == null) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (mapRef.current !== map) return;
        paint(map, layer, "line-width", width, "reveal", reduced);
        paint(map, layer, "line-opacity", 1, "settle", reduced);
      }),
    );
  };

  // ── camadas de cor (transição cruzada A/B) e pulso ──────────────────────────

  /** Aplica a camada; devolve true quando chegou dado novo (para o pulso). */
  const applyLayer = (map: MapLibreMap, layer: CanvasLayer | null): boolean => {
    const p = latest.current;
    const target: SourceId | null = layer ? (layer.level === "country" ? "ufs" : "mun") : null;
    const drawable = !!target && (target === "ufs" || !!sceneMesh(p));
    for (const source of ["ufs", "mun"] as const) {
      if (drawable && source === target) continue;
      paint(map, `${source}-a`, "fill-opacity", 0, "traverse", p.reduced);
      paint(map, `${source}-b`, "fill-opacity", 0, "traverse", p.reduced);
    }
    if (!drawable || !layer || !target) return false;
    const s = slots.current[target];
    const sig = canvasSignature(layer);
    const opacity = target === "mun" && heatOn(p) ? HEAT_FILL : 1;
    if (s.sig[s.active] === sig) {
      paint(map, `${target}-${s.active}`, "fill-opacity", opacity, "traverse", p.reduced);
      return false;
    }
    const next: Slot = s.active === "a" ? "b" : "a";
    for (const id of s.ids[next]) map.removeFeatureState({ source: target, id }, next);
    const ids: number[] = [];
    for (const [code, color] of Object.entries(layer.colors)) {
      const id = Number(code);
      map.setFeatureState({ source: target, id }, { [next]: color });
      ids.push(id);
    }
    s.ids[next] = ids;
    s.sig[next] = sig;
    paint(map, `${target}-${next}`, "fill-opacity", opacity, "traverse", p.reduced);
    paint(map, `${target}-${s.active}`, "fill-opacity", 0, "traverse", p.reduced);
    s.active = next;
    if (target === "mun") map.setPaintProperty("mun-extrude", "fill-extrusion-color", slotColorExpression(next, themeRef.current));
    return true;
  };

  /** Anel único nos maiores valores de uma grandeza somável, quando o dado chega. Nunca em laço. */
  const pulse = (map: MapLibreMap, layer: CanvasLayer) => {
    const p = latest.current;
    const motion = pulseMotion(p.reduced);
    if (!motion || !layer.extensive || layer.level !== "state" || p.view !== "mapa") return;
    const top = Object.entries(layer.magnitudes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, PULSE_TOP)
      .map(([code]) => Number(code));
    if (!top.length) return;
    map.setFilter("pulse", anyId(top));
    paint(map, "pulse", "circle-radius", motion.from, null, true);
    paint(map, "pulse", "circle-stroke-opacity", 0.9, null, true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (mapRef.current !== map) return;
        for (const [prop, value] of [["circle-radius", motion.to], ["circle-stroke-opacity", 0]] as const) {
          map.setPaintProperty("pulse", `${prop}-transition`, { duration: motion.duration, delay: duration.settle });
          map.setPaintProperty("pulse", prop, value);
        }
      }),
    );
  };

  // ── ciclo de vida ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!webglAvailable()) {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void (async () => {
      let ufs: TerritoryCollection;
      try {
        ufs = await loadUfMesh();
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      maplibre.setWorkerUrl(`/maplibre/worker-${maplibre.getVersion()}.mjs`);
      ufsRef.current = ufs;
      const map = new maplibre.Map({
        container: container.current,
        style: styleFor(currentTheme()),
        bounds: bboxOf(ufs.features),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        fadeDuration: 0,
        maxZoom: 13,
        maxPitch: 60,
        // O mapa ocupa boa parte da página: rolar a página sobre ele não pode virar zoom por engano.
        cooperativeGestures: true,
        locale: GESTURE_TEXT,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      mapRef.current = map;
      for (const ev of ["dragstart", "zoomstart"] as const)
        map.on(ev, (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) interacted.current = true;
        });
      // O contêiner muda de tamanho depois de montar (painéis, grade, rotação): redimensiona e reenquadra.
      let frame = 0;
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (mapRef.current !== map) return;
          map.resize();
          compareRef.current?.resize();
          if (!interacted.current) fit(false);
        });
      });
      observer.observe(container.current);
      map.on("load", () => {
        themeRef.current = currentTheme();
        addTerritoryLayers(map, themeRef.current, ufs);
        map.on("mousemove", onMove);
        map.on("mouseout", onLeave);
        map.on("click", onClick);
        setStatus("ready");
      });
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      compareRef.current?.remove();
      compareRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tema claro/escuro: repinta o cromo sem remontar (a cor dos dados chega em nova camada).
  useEffect(() => {
    themeRef.current = theme;
    const map = mapRef.current;
    if (status === "ready" && map) applyChrome(map, theme, slots.current.mun.active);
    if (compareReady && compareRef.current) applyChrome(compareRef.current, theme, "a");
  }, [theme, status, compareReady]);

  // Malha municipal da UF em cena (sob demanda). De volta ao Brasil, esvazia depois da transição.
  const sceneState = props.level === "country" ? null : props.stateCode;
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    if (!sceneState) {
      const timer = setTimeout(() => {
        if (mapRef.current !== map || latest.current.level !== "country") return;
        for (const target of [map, compareRef.current]) if (target) setCollection(target, "mun", emptyCollection);
        setCollection(map, "pts", emptyCollection);
        meshRef.current = null;
        setMeshState(null);
      }, duration.traverse + 40);
      return () => clearTimeout(timer);
    }
    if (meshRef.current?.state === sceneState) return;
    let active = true;
    loadMunicipalityMesh(sceneState)
      .then((mesh) => {
        if (!active || mapRef.current !== map) return;
        meshRef.current = { state: sceneState, collection: mesh, byId: new Map(mesh.features.map((f) => [f.id, f])) };
        setCollection(map, "mun", mesh);
        setCollection(map, "pts", pointsOf(mesh));
        if (compareRef.current) setCollection(compareRef.current, "mun", mesh);
        // nova malha: a próxima camada reescreve as cores (o estado da feição não depende da troca de dados)
        slots.current.mun.sig = { a: "", b: "" };
        setMeshFailed(null);
        setMeshState(sceneState);
      })
      .catch(() => {
        if (active && mapRef.current === map) setMeshFailed(sceneState);
      });
    return () => {
      active = false;
    };
  }, [status, sceneState, meshAttempt]);

  // Câmera: Brasil → UF → município (survey/traverse); a malha chegando depois completa a aproximação.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    interacted.current = false;
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.level, props.stateCode, props.municipality]);
  useEffect(() => {
    if (status !== "ready" || !meshState || latest.current.level !== "municipality" || interacted.current) return;
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshState]);

  // Holofote e contorno revelado do território escolhido.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const p = latest.current;
    const stateId = p.level !== "country" && p.stateCode ? Number(p.stateCode) : null;
    const munId = p.level === "municipality" && p.municipality && meshRef.current ? Number(p.municipality) : null;
    if (hover.current) setHover(null);
    hideTooltip();
    map.setFilter("ufs-veil", exceptId(stateId));
    paint(map, "ufs-veil", "fill-opacity", stateId == null ? 0 : VEIL.context, "traverse", p.reduced);
    map.setFilter("mun-veil", exceptId(munId));
    paint(map, "mun-veil", "fill-opacity", munId == null ? 0 : VEIL.spotlight, "traverse", p.reduced);
    reveal(map, "ufs-outline", stateId, 2, p.reduced);
    reveal(map, "mun-outline", munId, 2.5, p.reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.level, props.stateCode, props.municipality, meshState]);

  // Camada de cor: transição cruzada; dado novo de contagem ganha o pulso.
  const layerSig = canvasSignature(props.layer);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const layer = latest.current.layer;
    if (applyLayer(map, layer) && layer) pulse(map, layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, layerSig, meshState, props.level]);

  // Relevo (altura ∝ valor, câmera inclinada) e intensidade (calor sobre pontos internos).
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const p = latest.current;
    const mesh = sceneMesh(p);
    const relief = reliefOn(p) && !!mesh;
    if (relief && mesh && p.layer) {
      const [w, s, e, n] = bboxOf(mesh.collection.features);
      const midLat = ((s + n) / 2) * (Math.PI / 180);
      const diagonal = Math.hypot((e - w) * 111_320 * Math.cos(midLat), (n - s) * 110_540);
      const top = diagonal * 0.09;
      for (const f of mesh.collection.features) map.setFeatureState({ source: "mun", id: f.id }, { h: (p.layer.magnitudes[String(f.id)] ?? 0) * top });
      map.setLayoutProperty("mun-extrude", "visibility", "visible");
    }
    paint(map, "mun-extrude", "fill-extrusion-opacity", relief ? 0.92 : 0, relief ? "traverse" : "settle", p.reduced);
    // Um easeTo só de inclinação cancelaria o voo em curso (troca de UF): sem gesto da pessoa, o enquadramento,
    // que já leva a inclinação, refaz o voo; depois de um gesto, só a inclinação muda, no lugar.
    const pitch = reliefOn(p) ? RELIEF_PITCH : 0;
    if (pitchTarget.current !== pitch) {
      if (interacted.current) {
        pitchTarget.current = pitch;
        const motion = cameraMotion("survey", p.reduced);
        map.easeTo({ pitch, center: map.getCenter(), zoom: map.getZoom(), duration: motion.duration, easing: motion.easing });
      } else fit(true);
    }
    const heat = heatOn(p) && !!mesh;
    if (heat && mesh && p.layer) for (const f of mesh.collection.features) map.setFeatureState({ source: "pts", id: f.id }, { w: p.layer.magnitudes[String(f.id)] ?? 0 });
    paint(map, "heat", "heatmap-opacity", heat ? 0.85 : 0, "traverse", p.reduced);
    if (p.level !== "country") paint(map, `mun-${slots.current.mun.active}`, "fill-opacity", heat ? HEAT_FILL : 1, "traverse", p.reduced);
    if (relief) return;
    const timer = setTimeout(() => {
      if (mapRef.current === map && !reliefOn(latest.current)) map.setLayoutProperty("mun-extrude", "visibility", "none");
    }, duration.settle + 40);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.view, layerSig, meshState, props.level, props.allowRelief]);

  // Hover vindo da tabela: mesmo destaque e o rótulo no ponto interno do território.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const p = latest.current;
    if (p.hovered == null) {
      if (hoverFromOutside.current) {
        setHover(null);
        hideTooltip();
        hoverFromOutside.current = false;
      }
      return;
    }
    const source: SourceId = p.level === "country" ? "ufs" : "mun";
    const id = Number(p.hovered);
    if (hover.current?.id === id && hover.current.source === source) return;
    const feature = source === "ufs" ? ufsRef.current?.features.find((f) => f.id === id) : sceneMesh(p)?.byId.get(id);
    if (!feature) return;
    hoverFromOutside.current = true;
    const hit = { source, id, name: feature.properties.name };
    setHover(hit);
    showTooltip(map.project(insidePoint(feature.geometry)), hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.hovered, props.level, meshState]);

  // Antes/depois: segundo mapa (só leitura) sob o divisor, com a câmera do principal.
  const comparing = compareOn(props);
  useEffect(() => {
    const main = mapRef.current;
    const host = compareHost.current;
    const ufs = ufsRef.current;
    if (status !== "ready" || !comparing || !main || !host || !ufs) return;
    let cancelled = false;
    const sync = () =>
      compareRef.current?.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing(), pitch: main.getPitch() });
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      const other = new maplibre.Map({
        container: host,
        style: styleFor(themeRef.current),
        center: main.getCenter(),
        zoom: main.getZoom(),
        pitch: main.getPitch(),
        bearing: main.getBearing(),
        interactive: false,
        attributionControl: false,
        renderWorldCopies: false,
        fadeDuration: 0,
        maxPitch: 60,
      });
      compareRef.current = other;
      other.on("load", () => {
        if (cancelled) return;
        addTerritoryLayers(other, themeRef.current, ufs, true);
        if (meshRef.current) setCollection(other, "mun", meshRef.current.collection);
        compareColored.current = { source: "ufs", ids: [] };
        sync();
        setCompareReady(true);
      });
    })();
    main.on("move", sync);
    return () => {
      cancelled = true;
      main.off("move", sync);
      compareRef.current?.remove();
      compareRef.current = null;
      setCompareReady(false);
    };
  }, [status, comparing]);

  // holofote e contorno também no lado "antes"
  useEffect(() => {
    const other = compareRef.current;
    if (!compareReady || !other) return;
    const p = latest.current;
    const stateId = p.level !== "country" && p.stateCode ? Number(p.stateCode) : null;
    const munId = p.level === "municipality" && p.municipality ? Number(p.municipality) : null;
    other.setFilter("ufs-veil", exceptId(stateId));
    paint(other, "ufs-veil", "fill-opacity", stateId == null ? 0 : VEIL.context, null, true);
    other.setFilter("mun-veil", exceptId(munId));
    paint(other, "mun-veil", "fill-opacity", munId == null ? 0 : VEIL.spotlight, null, true);
    other.setFilter("ufs-outline", onlyId(stateId));
    other.setFilter("mun-outline", onlyId(munId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareReady, props.level, props.stateCode, props.municipality, meshState]);

  const beforeSig = canvasSignature(props.before?.layer);
  useEffect(() => {
    const other = compareRef.current;
    const layer = latest.current.before?.layer;
    if (!compareReady || !other || !layer) return;
    const target: SourceId = layer.level === "country" ? "ufs" : "mun";
    const previous = compareColored.current;
    for (const id of previous.ids) other.removeFeatureState({ source: previous.source, id }, "a");
    const ids = Object.entries(layer.colors).map(([code, color]) => {
      other.setFeatureState({ source: target, id: Number(code) }, { a: color });
      return Number(code);
    });
    compareColored.current = { source: target, ids };
    for (const source of ["ufs", "mun"] as const) paint(other, `${source}-a`, "fill-opacity", source === target ? 1 : 0, null, true);
  }, [compareReady, beforeSig, meshState]);

  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    interacted.current = true;
    map.easeTo({ zoom: map.getZoom() + delta, duration: props.reduced ? 0 : duration.acknowledge });
  };
  const refit = () => {
    interacted.current = false;
    fit(true);
  };

  const legend = props.layer?.legend;
  const note = viewNote(drawnView(props), props.layer);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-canvas" data-testid="territory-canvas-frame">
      <div
        ref={container}
        className="absolute inset-0"
        role="region"
        aria-label={props.label}
        aria-describedby={descriptionId}
        data-testid="territory-canvas"
      />
      <p id={descriptionId} className="sr-only">
        Mapa interativo. Para navegar pelo teclado, use a lista de territórios logo abaixo: ela traz os mesmos dados.
      </p>
      {comparing && props.before && (
        <>
          <div ref={compareHost} className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-fg/70" style={{ left: `${split}%` }} aria-hidden="true" />
          <span className="pointer-events-none absolute left-3 top-3 z-10 max-w-[40%] truncate rounded-md border border-line bg-canvas/90 px-2 py-1 text-micro font-semibold text-fg">
            {props.before.label}
          </span>
          <span className="pointer-events-none absolute right-14 top-3 z-10 max-w-[40%] truncate rounded-md border border-line bg-canvas/90 px-2 py-1 text-micro font-semibold text-fg">
            {props.afterLabel}
          </span>
          <label className="absolute inset-x-3 bottom-8 z-10 flex items-center gap-2 rounded-md border border-line bg-canvas/90 px-2 py-1 text-micro text-fg-soft">
            <span className="whitespace-nowrap">Divisor</span>
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={split}
              onChange={(event) => setSplit(Number(event.target.value))}
              aria-label="Posição do divisor entre os dois lados do mapa"
              aria-valuetext={`${split}% do mapa mostra: ${props.before.label}`}
              className="focus-ring h-6 w-full accent-[rgb(var(--accent))]"
              data-testid="compare-divider"
            />
          </label>
        </>
      )}
      <div
        ref={tooltip}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-20 max-w-[240px] rounded-md border border-line bg-canvas/95 px-2.5 py-1.5 text-xs text-fg opacity-0 shadow-lg transition-opacity duration-[var(--motion-acknowledge)] motion-reduce:transition-none"
        data-testid="territory-tooltip"
      />
      {status === "ready" && (
        <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border border-line bg-canvas/90" data-testid="map-controls">
          <button type="button" onClick={() => zoomBy(1)} aria-label="Aproximar o mapa" title="Aproximar" className={CONTROL}>+</button>
          <button type="button" onClick={() => zoomBy(-1)} aria-label="Afastar o mapa" title="Afastar" className={CONTROL}>−</button>
          <button type="button" onClick={refit} aria-label="Enquadrar o território" title="Enquadrar o território" className={CONTROL}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8V5a2 2 0 0 1 2-2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            </svg>
          </button>
        </div>
      )}
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-fg-muted" data-testid="territory-canvas-status">
          {status === "loading" && "Carregando a malha territorial oficial (IBGE)…"}
          {status === "error" && "Malha territorial indisponível agora. A tabela abaixo traz os mesmos dados."}
          {status === "unsupported" && "Mapa indisponível neste navegador (WebGL). A tabela abaixo traz os mesmos dados."}
        </div>
      )}
      {status === "ready" && sceneState && meshFailed === sceneState && (
        <div
          className="absolute left-3 right-14 top-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-canvas/95 px-3 py-2 text-xs text-fg-soft"
          role="status"
          data-testid="territory-mesh-error"
        >
          <span>Não foi possível carregar os municípios desta UF. A tabela abaixo traz os mesmos dados.</span>
          <RetryButton
            onRetry={() => {
              setMeshFailed(null);
              setMeshAttempt((n) => n + 1);
            }}
          />
        </div>
      )}
      {legend && !comparing && (
        <div className="pointer-events-none absolute bottom-8 left-3 z-10 hidden max-w-[17rem] rounded-md border border-line bg-canvas/90 px-2.5 py-2 sm:block">
          <MapLegend legend={legend} />
          {note && <p className="mt-1 max-w-[16rem] text-micro text-fg-muted" data-testid="map-view-note">{note}</p>}
        </div>
      )}
      <p className="pointer-events-none absolute bottom-1.5 left-3 text-[10px] text-fg-muted">Malhas: IBGE</p>
    </div>
  );
}
