import {
  AB,
  CATEGORICAL as PALETTE_CATEGORICAL,
  CHOROPLETH_SLOTS,
  DIVERGING,
  MAP_CHROME,
  OTHER,
  SEQUENTIAL,
  mix,
  type DataTheme,
} from "@/lib/dataviz/palette";
import { BASE_CLASS_LABEL, BASE_CLASSES, baseClassColor, type BaseClass } from "./base";
import { formatCount, formatPercent } from "./format";
import { CELL_STATE_LABEL, comparabilityLabel, signed, signedPercent } from "./xray";
import type { CellState, MapFeature, MapLayerKind, MapLayerResponse } from "./xray-types";

/**
 * Camadas temáticas do mapa. Os VALORES vêm da API; aqui só se escolhe a cor. Paleta neutra do REPBrasil:
 * sequencial (um matiz), divergente (crescimento × queda) e categórica por ordem da legenda — nunca cor de partido.
 */

export const LAYER_LABEL: Record<MapLayerKind, string> = {
  intensity: "Intensidade de votos",
  share: "% dos votos válidos",
  winner: "Mais votado(a)",
  growth: "Crescimento",
  decline: "Queda",
  ab: "A × B",
  base: "Base eleitoral",
  party: "Partido",
};

/** Paleta da camada: neutra, sem cor de partido (src/lib/dataviz/palette.ts). Tema claro por padrão. */
export { mix };
export const CATEGORICAL = PALETTE_CATEGORICAL.light;

export interface LayerValue {
  color: string | null;
  text: string;
}

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
}

export interface MapLayerView {
  kind: MapLayerKind;
  level: "municipality" | "place";
  /** Município: chave = código IBGE (id da feição da malha). */
  municipalities: Record<string, LayerValue>;
  places: Array<LayerValue & { key: string; name: string; latitude: number; longitude: number }>;
  legend: LegendEntry[];
  gradient: { from: string; to: string; min: string; max: string } | null;
  note: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function stateText(state: string): string {
  return state === "value" ? "sem valor" : (CELL_STATE_LABEL[state as CellState] ?? "sem valor");
}

// ── Texto do tooltip, por camada ────────────────────────────────────────────

function intensityText(f: MapFeature): string {
  if (f.value === null) return stateText(f.state);
  const share = num(f.details.share);
  return share === null ? `${formatCount(f.value)} votos` : `${formatCount(f.value)} votos · ${formatPercent(share)}`;
}

function shareText(f: MapFeature): string {
  if (f.value === null) return stateText(f.state);
  return `${formatPercent(f.value)} dos válidos · ${formatCount(num(f.details.votes))} votos`;
}

/** Partido: participação no cargo; fora da disputa municipal o motivo, nunca zero. */
function partyText(f: MapFeature): string {
  if (f.value === null) return stateText(f.state);
  const elected = num(f.details.elected);
  const head = `${formatPercent(f.value)} dos válidos · ${formatCount(num(f.details.votes))} votos`;
  return elected ? `${head} · ${elected} eleito${elected === 1 ? "" : "s"}` : head;
}

function winnerText(f: MapFeature): string {
  if (!f.categoryLabel) return "sem resultado";
  const margin = num(f.details.marginVotes);
  const head = `${f.categoryLabel} · ${formatPercent(f.value)}`;
  return margin === null ? head : `${head} · margem ${formatCount(margin)}`;
}

/** Com delta: variação. Sem delta: o motivo (disputa ou território) e, se existirem, os dois valores lado a lado. */
function deltaText(r: MapLayerResponse, f: MapFeature): string {
  const delta = num(f.details.deltaVotes);
  if (delta !== null) return `${signed(delta)} votos (${signedPercent(num(f.details.deltaPercent))})`;
  const territory = f.details.comparability;
  let reason = typeof territory === "string" ? comparabilityLabel(territory) : "sem comparação";
  if (r.comparability && r.comparability !== "comparable_contest") reason = comparabilityLabel(r.comparability);
  const from = num(f.details.fromVotes);
  const to = num(f.details.toVotes);
  return from === null || to === null ? reason : `${reason} · ${formatCount(from)} → ${formatCount(to)} votos`;
}

/** Com diferença: A × B e o saldo. Sem diferença: o motivo (disputa ou território) e os votos lado a lado. */
function abText(r: MapLayerResponse, f: MapFeature): string {
  const a = num(f.details.aVotes);
  const b = num(f.details.bVotes);
  if (f.value !== null) return `A ${formatCount(a)} × B ${formatCount(b)} (${signed(f.value)})`;
  let reason = f.state === "comparable" ? "sem comparação completa" : comparabilityLabel(f.state);
  if (r.comparability && r.comparability !== "comparable_contest") reason = comparabilityLabel(r.comparability);
  return a === null || b === null ? reason : `${reason} · A ${formatCount(a)} × B ${formatCount(b)}`;
}

function baseText(f: MapFeature): string {
  if (!f.categoryLabel) return stateText(f.state);
  const votes = num(f.details.votes);
  const rank = num(f.details.rank);
  const contestants = num(f.details.contestants);
  const parts = [f.categoryLabel];
  if (votes !== null) parts.push(`${formatCount(votes)} votos`);
  if (rank !== null && contestants !== null) parts.push(`${rank}º de ${contestants}`);
  return parts.join(" · ");
}

function valueText(r: MapLayerResponse, f: MapFeature): string {
  switch (r.layer) {
    case "base":
      return baseText(f);
    case "intensity":
      return intensityText(f);
    case "share":
      return shareText(f);
    case "party":
      return partyText(f);
    case "winner":
      return winnerText(f);
    case "growth":
    case "decline":
      return deltaText(r, f);
    case "ab":
      return abText(r, f);
  }
}

// ── Cor, por camada ─────────────────────────────────────────────────────────

interface Scale {
  max: number;
  maxAbs: number;
  legendIndex: Map<string, number>;
  theme: DataTheme;
}

/**
 * Mais vencedores do que a paleta categórica comporta (ex.: Prefeito no estado — cada município tem a sua
 * disputa): repetir cores sugeriria o mesmo vencedor em lugares diferentes. A cor passa a indicar só a % de
 * quem venceu em cada território (escala sequencial); o nome aparece no tooltip.
 */
const manyWinners = (r: MapLayerResponse) => r.layer === "winner" && r.legend.length > PALETTE_CATEGORICAL.light.length;

/**
 * Coroplético: só os 3 primeiros slots categóricos são distinguíveis em todos os pares (inclusive com
 * daltonismo). Do 4º vencedor em diante, a cor é "Outros" e o nome continua no tooltip e na legenda.
 */
function winnerColor(f: MapFeature, scale: Scale): string | null {
  if (!f.category) return null;
  const i = f.category === "tie" ? undefined : scale.legendIndex.get(f.category);
  if (i === undefined) return AB[scale.theme].tie;
  return i < CHOROPLETH_SLOTS ? PALETTE_CATEGORICAL[scale.theme][i] : OTHER[scale.theme];
}

function abColor(f: MapFeature, value: number, scale: Scale): string {
  const { a, b, tie } = AB[scale.theme];
  const base = MAP_CHROME[scale.theme].land;
  const strength = 0.35 + 0.65 * (scale.maxAbs > 0 ? Math.abs(value) / scale.maxAbs : 0);
  if (f.category === "a") return mix(base, a, strength);
  if (f.category === "b") return mix(base, b, strength);
  return tie;
}

/** Crescimento/queda: o outro sentido (e o estável) chega da API como 0 e fica no meio neutro. */
function deltaColor(value: number, scale: Scale): string {
  const { positive, negative, neutral } = DIVERGING[scale.theme];
  if (value === 0) return neutral;
  const strength = 0.3 + 0.7 * (scale.maxAbs > 0 ? Math.abs(value) / scale.maxAbs : 0);
  return mix(neutral, value > 0 ? positive : negative, strength);
}

function colorOf(r: MapLayerResponse, f: MapFeature, scale: Scale): string | null {
  // classe da Base Eleitoral: ordinal de um matiz; território não classificado fica sem cor (nunca "muito fraco")
  if (r.layer === "base") return f.category && (BASE_CLASSES as readonly string[]).includes(f.category) ? baseClassColor(f.category as BaseClass, scale.theme) : null;
  if (r.layer === "winner" && !manyWinners(r)) return winnerColor(f, scale);
  if (f.value === null) return null;
  if (r.layer === "ab") return abColor(f, f.value, scale);
  if (r.layer === "growth" || r.layer === "decline") return deltaColor(f.value, scale);
  const { low, high } = SEQUENTIAL[scale.theme];
  // zero real é o primeiro passo da rampa (ainda colorido); "sem dado" fica na cor da terra
  return scale.max > 0 ? mix(low, high, f.value / scale.max) : low;
}

function legendOf(r: MapLayerResponse, theme: DataTheme): LegendEntry[] {
  if (r.layer === "base") return BASE_CLASSES.map((c) => ({ key: c, label: BASE_CLASS_LABEL[c], color: baseClassColor(c, theme) }));
  if (manyWinners(r)) return [];
  if (r.layer === "winner") {
    const shown = r.legend.slice(0, CHOROPLETH_SLOTS).map((l, i) => ({ key: l.category, label: l.label, color: PALETTE_CATEGORICAL[theme][i] }));
    const rest = r.legend.length - CHOROPLETH_SLOTS;
    return rest > 0
      ? [...shown, { key: "other", label: `Outros (${rest}) — nome no detalhe do território`, color: OTHER[theme] }]
      : shown;
  }
  if (r.layer === "ab") {
    const name = (category: string) => r.legend.find((l) => l.category === category)?.label ?? category.toUpperCase();
    return [
      { key: "a", label: `A: ${name("a")}`, color: AB[theme].a },
      { key: "b", label: `B: ${name("b")}`, color: AB[theme].b },
      { key: "tie", label: "Empate", color: AB[theme].tie },
    ];
  }
  if (r.layer === "growth")
    return [
      { key: "up", label: "Crescimento", color: DIVERGING[theme].positive },
      { key: "flat", label: "Sem crescimento (estável ou queda)", color: DIVERGING[theme].neutral },
    ];
  if (r.layer === "decline")
    return [
      { key: "down", label: "Queda", color: DIVERGING[theme].negative },
      { key: "flat", label: "Sem queda (estável ou crescimento)", color: DIVERGING[theme].neutral },
    ];
  return [];
}

function gradientOf(r: MapLayerResponse, theme: DataTheme): MapLayerView["gradient"] {
  if (r.layer !== "intensity" && r.layer !== "share" && r.layer !== "party" && !manyWinners(r)) return null;
  const format = r.layer === "intensity" ? formatCount : formatPercent;
  return { from: SEQUENTIAL[theme].low, to: SEQUENTIAL[theme].high, min: format(r.min), max: format(r.max) };
}

export function buildLayerView(r: MapLayerResponse, theme: DataTheme = "light"): MapLayerView {
  const values = r.features.map((f) => f.value).filter((v): v is number => v !== null);
  const scale: Scale = {
    max: values.length ? Math.max(...values) : 0,
    maxAbs: values.length ? Math.max(...values.map(Math.abs)) : 0,
    legendIndex: new Map(r.legend.map((l, i) => [l.category, i])),
    theme,
  };
  const municipalities: Record<string, LayerValue> = {};
  const places: MapLayerView["places"] = [];
  for (const f of r.features) {
    const v = { color: colorOf(r, f, scale), text: valueText(r, f) };
    if (r.level === "municipality" && f.ibgeCode != null) municipalities[String(f.ibgeCode)] = v;
    if (r.level === "place" && f.latitude != null && f.longitude != null)
      places.push({ ...v, key: f.key, name: f.name, latitude: f.latitude, longitude: f.longitude });
  }
  const note = manyWinners(r)
    ? `Candidatura com mais votos em cada território, sem cor partidária. ${r.legend.length} vencedores diferentes: a cor indica a % de quem venceu em cada território; o nome aparece ao passar o mouse.`
    : r.note;
  return { kind: r.layer, level: r.level, municipalities, places, legend: legendOf(r, theme), gradient: gradientOf(r, theme), note };
}

/**
 * Assinatura estável da camada temática: muda quando muda qualquer coisa escrita no mapa — cor dos municípios e,
 * nos locais de votação (GeoJSON), cor, texto do tooltip, nome e coordenadas.
 */
export function layerSignature(layer: MapLayerView | null | undefined): string {
  if (!layer) return "";
  const municipalities = Object.entries(layer.municipalities).map(([k, v]) => k + ":" + v.color);
  const places = layer.places.map((p) => [p.key, p.color, p.text, p.name, p.latitude, p.longitude].join(":"));
  return [layer.kind, layer.level, municipalities.join(","), places.join(",")].join("|");
}
