import { formatCount, formatPercent } from "./format";
import { signed, signedPercent } from "./xray";
import type { MapFeature, MapLayerKind, MapLayerResponse } from "./xray-types";

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
  const n = parseInt(c.slice(1), 16);
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

function valueText(kind: MapLayerKind, f: MapFeature): string {
  const d = f.details as Record<string, number | null | undefined>;
  switch (kind) {
    case "intensity":
      return f.value === null ? stateText(f.state) : `${formatCount(f.value)} votos${d.share != null ? ` · ${formatPercent(d.share)}` : ""}`;
    case "share":
      return f.value === null ? stateText(f.state) : `${formatPercent(f.value)} dos válidos · ${formatCount(d.votes ?? null)} votos`;
    case "winner":
      return f.categoryLabel ? `${f.categoryLabel} · ${formatPercent(f.value)}${d.marginVotes != null ? ` · margem ${formatCount(d.marginVotes)}` : ""}` : "sem resultado";
    case "growth":
    case "decline":
      return d.deltaVotes == null ? String(f.details.comparability ?? "sem comparação") : `${signed(d.deltaVotes)} votos (${signedPercent(d.deltaPercent ?? null)})`;
    case "ab":
      return f.value === null ? "sem comparação completa" : `A ${formatCount(d.aVotes ?? null)} × B ${formatCount(d.bVotes ?? null)} (${signed(f.value)})`;
  }
}

function stateText(state: string): string {
  const labels: Record<string, string> = {
    no_coverage: "sem Boletim de Urna",
    outside_contest: "fora da disputa",
    partial_coverage: "cobertura parcial",
    unlinked: "sem vínculo auditado",
    not_on_ballot: "fora da urna",
  };
  return labels[state] ?? "sem valor";
}

export function buildLayerView(r: MapLayerResponse): MapLayerView {
  const values = r.features.map((f) => f.value).filter((v): v is number => v !== null);
  const maxAbs = values.length ? Math.max(...values.map(Math.abs)) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const legendIndex = new Map(r.legend.map((l, i) => [l.category, i]));

  const colorOf = (f: MapFeature): string | null => {
    if (r.layer === "winner") {
      if (!f.category) return null;
      if (f.category === "tie") return TIE;
      const i = legendIndex.get(f.category);
      return i === undefined ? TIE : CATEGORICAL[i % CATEGORICAL.length];
    }
    if (f.value === null) return null;
    if (r.layer === "ab") {
      const t = maxAbs > 0 ? Math.abs(f.value) / maxAbs : 0;
      return f.category === "a" ? mix(NEUTRAL, A_COLOR, 0.35 + 0.65 * t) : f.category === "b" ? mix(NEUTRAL, B_COLOR, 0.35 + 0.65 * t) : TIE;
    }
    if (r.layer === "growth" || r.layer === "decline") {
      if (f.value === 0) return mix(NEUTRAL, TIE, 0.3);
      const t = maxAbs > 0 ? Math.abs(f.value) / maxAbs : 0;
      return f.value > 0 ? mix(NEUTRAL, HIGH, 0.3 + 0.7 * t) : mix(NEUTRAL, NEGATIVE, 0.3 + 0.7 * t);
    }
    return max > 0 ? mix(LOW, HIGH, f.value / max) : LOW;
  };

  const municipalities: Record<string, LayerValue> = {};
  const places: MapLayerView["places"] = [];
  for (const f of r.features) {
    const v = { color: colorOf(f), text: valueText(r.layer, f) };
    if (r.level === "municipality" && f.ibgeCode != null) municipalities[String(f.ibgeCode)] = v;
    if (r.level === "place" && f.latitude != null && f.longitude != null)
      places.push({ ...v, key: f.key, name: f.name, latitude: f.latitude, longitude: f.longitude });
  }

  let legend: LegendEntry[] = [];
  if (r.layer === "winner")
    legend = r.legend.map((l, i) => ({ key: l.category, label: l.label, color: CATEGORICAL[i % CATEGORICAL.length] }));
  else if (r.layer === "ab")
    legend = [
      { key: "a", label: `A: ${r.legend.find((l) => l.category === "a")?.label ?? "A"}`, color: A_COLOR },
      { key: "b", label: `B: ${r.legend.find((l) => l.category === "b")?.label ?? "B"}`, color: B_COLOR },
      { key: "tie", label: "Empate", color: TIE },
    ];
  else if (r.layer === "growth" || r.layer === "decline")
    legend = [
      { key: "up", label: "Crescimento", color: HIGH },
      { key: "down", label: "Queda", color: NEGATIVE },
    ];

  const gradient =
    r.layer === "intensity" || r.layer === "share"
      ? {
          from: LOW,
          to: HIGH,
          min: r.layer === "share" ? formatPercent(r.min) : formatCount(r.min),
          max: r.layer === "share" ? formatPercent(r.max) : formatCount(r.max),
        }
      : null;
  return { kind: r.layer, level: r.level, municipalities, places, legend, gradient, note: r.note };
}
