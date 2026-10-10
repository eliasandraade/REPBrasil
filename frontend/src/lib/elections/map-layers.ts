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
};

export const NEUTRAL = "#16212f";
const LOW = "#1b3a3a";
const HIGH = "#0dd48e";
const NEGATIVE = "#f59e0b";
const A_COLOR = "#38bdf8";
const B_COLOR = "#a78bfa";
const TIE = "#94a3b8";
/** Paleta categórica neutra, atribuída pela ORDEM da legenda (nunca pelo partido). */
export const CATEGORICAL = ["#38bdf8", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#fb923c", "#e879f9", "#94a3b8"];

function hex(c: string): [number, number, number] {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r1 + (r2 - r1) * k)}${to(g1 + (g2 - g1) * k)}${to(b1 + (b2 - b1) * k)}`;
}

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

function abText(f: MapFeature): string {
  if (f.value === null) return "sem comparação completa";
  return `A ${formatCount(num(f.details.aVotes))} × B ${formatCount(num(f.details.bVotes))} (${signed(f.value)})`;
}

function valueText(r: MapLayerResponse, f: MapFeature): string {
  switch (r.layer) {
    case "intensity":
      return intensityText(f);
    case "share":
      return shareText(f);
    case "winner":
      return winnerText(f);
    case "growth":
    case "decline":
      return deltaText(r, f);
    case "ab":
      return abText(f);
  }
}

// ── Cor, por camada ─────────────────────────────────────────────────────────

interface Scale {
  max: number;
  maxAbs: number;
  legendIndex: Map<string, number>;
}

function winnerColor(f: MapFeature, legendIndex: Map<string, number>): string | null {
  if (!f.category) return null;
  const i = f.category === "tie" ? undefined : legendIndex.get(f.category);
  return i === undefined ? TIE : CATEGORICAL[i % CATEGORICAL.length];
}

function abColor(f: MapFeature, value: number, maxAbs: number): string {
  const strength = 0.35 + 0.65 * (maxAbs > 0 ? Math.abs(value) / maxAbs : 0);
  if (f.category === "a") return mix(NEUTRAL, A_COLOR, strength);
  if (f.category === "b") return mix(NEUTRAL, B_COLOR, strength);
  return TIE;
}

/** Crescimento/queda: o outro sentido (e o estável) chega da API como 0 e fica nesta cor. */
const FLAT = mix(NEUTRAL, TIE, 0.3);

function deltaColor(value: number, maxAbs: number): string {
  if (value === 0) return FLAT;
  const strength = 0.3 + 0.7 * (maxAbs > 0 ? Math.abs(value) / maxAbs : 0);
  return mix(NEUTRAL, value > 0 ? HIGH : NEGATIVE, strength);
}

/**
 * Mais vencedores do que cores distintas (ex.: Prefeito no estado — cada município tem a sua disputa):
 * repetir cores sugeriria o mesmo vencedor em lugares diferentes. A cor passa a indicar só a % de quem
 * venceu em cada território (escala sequencial); o nome aparece no tooltip.
 */
const manyWinners = (r: MapLayerResponse) => r.layer === "winner" && r.legend.length > CATEGORICAL.length;

function colorOf(r: MapLayerResponse, f: MapFeature, scale: Scale): string | null {
  if (r.layer === "winner" && !manyWinners(r)) return winnerColor(f, scale.legendIndex);
  if (f.value === null) return null;
  if (r.layer === "ab") return abColor(f, f.value, scale.maxAbs);
  if (r.layer === "growth" || r.layer === "decline") return deltaColor(f.value, scale.maxAbs);
  return scale.max > 0 ? mix(LOW, HIGH, f.value / scale.max) : LOW;
}

function legendOf(r: MapLayerResponse): LegendEntry[] {
  if (manyWinners(r)) return [];
  if (r.layer === "winner") return r.legend.map((l, i) => ({ key: l.category, label: l.label, color: CATEGORICAL[i] }));
  if (r.layer === "ab") {
    const name = (category: string) => r.legend.find((l) => l.category === category)?.label ?? category.toUpperCase();
    return [
      { key: "a", label: `A: ${name("a")}`, color: A_COLOR },
      { key: "b", label: `B: ${name("b")}`, color: B_COLOR },
      { key: "tie", label: "Empate", color: TIE },
    ];
  }
  if (r.layer === "growth")
    return [
      { key: "up", label: "Crescimento", color: HIGH },
      { key: "flat", label: "Sem crescimento (estável ou queda)", color: FLAT },
    ];
  if (r.layer === "decline")
    return [
      { key: "down", label: "Queda", color: NEGATIVE },
      { key: "flat", label: "Sem queda (estável ou crescimento)", color: FLAT },
    ];
  return [];
}

function gradientOf(r: MapLayerResponse): MapLayerView["gradient"] {
  if (r.layer !== "intensity" && r.layer !== "share" && !manyWinners(r)) return null;
  const format = r.layer === "intensity" ? formatCount : formatPercent;
  return { from: LOW, to: HIGH, min: format(r.min), max: format(r.max) };
}

export function buildLayerView(r: MapLayerResponse): MapLayerView {
  const values = r.features.map((f) => f.value).filter((v): v is number => v !== null);
  const scale: Scale = {
    max: values.length ? Math.max(...values) : 0,
    maxAbs: values.length ? Math.max(...values.map(Math.abs)) : 0,
    legendIndex: new Map(r.legend.map((l, i) => [l.category, i])),
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
  return { kind: r.layer, level: r.level, municipalities, places, legend: legendOf(r), gradient: gradientOf(r), note };
}
