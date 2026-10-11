import { fetchJson } from "@/lib/api";
import { ORDINAL_5, type DataTheme } from "@/lib/dataviz/palette";
import type { ContestRef, Freshness, Insight, TerritoryLevel, TerritoryValue } from "./xray-types";

/** Base Eleitoral (GET /api/v1/elections/candidacies/{id}/base). Espelha ElectoralBaseResponse do backend. */

export type BaseClass = "stronghold" | "strong" | "competitive" | "weak" | "very_weak";

export interface BaseComponent {
  key: "share_percentile" | "position" | "leader_ratio" | "volume_percentile";
  value: number;
  weight: number;
  contribution: number;
}

export interface BaseChange {
  fromCandidacyId: string;
  fromYear: number;
  fromRound: number;
  comparability: string;
  fromVotes: number | null;
  fromShare: number | null;
  fromRank: number | null;
  deltaVotes: number | null;
  deltaPercent: number | null;
  deltaSharePoints: number | null;
  rankChange: number | null;
}

export interface TerritoryBase {
  key: string;
  territory: TerritoryValue;
  rank: number | null;
  contestants: number | null;
  leaderVotes: number | null;
  marginPoints: number | null;
  sharePercentile: number | null;
  volumePercentile: number | null;
  score: number | null;
  class: BaseClass | null;
  components: BaseComponent[];
  change: BaseChange | null;
}

export interface BaseFormula {
  version: string;
  components: Array<{ key: BaseComponent["key"]; label: string; weight: number; definition: string }>;
  classes: Array<{ key: BaseClass; label: string; minScore: number }>;
  minTerritoriesForPercentiles: number;
  note: string;
}

export interface ElectoralBaseSummary {
  votes: number | null;
  territories: number;
  territoriesWithVotes: number;
  capillarity: number | null;
  hhi: number | null;
  topFiveConcentration: number | null;
  classCounts: Record<BaseClass, number>;
  leading: number;
  competitive: number;
  critical: number;
}

export interface ElectoralBaseHighlights {
  strongest: string[];
  weakest: string[];
  competitive: string[];
  highestShare: string[];
  highestVolume: string[];
  growth: string[];
  decline: string[];
  gainedPosition: string[];
  lostPosition: string[];
  critical: string[];
}

export interface ElectoralBaseResponse {
  candidacyId: string;
  contest: ContestRef;
  level: TerritoryLevel;
  municipalityTseCode: string | null;
  zone: number | null;
  formula: BaseFormula;
  summary: ElectoralBaseSummary;
  territories: TerritoryBase[];
  highlights: ElectoralBaseHighlights;
  comparedWith: { candidacyId: string; year: number; round: number; comparability: string; note: string } | null;
  insights: Insight[];
  freshness: Freshness;
  definitions: Record<string, string>;
}

/** Escopo ativo do produto: disputas nacionais abrem neste estado. */
export const DEFAULT_UF = "CE";

export const BASE_CLASSES: readonly BaseClass[] = ["stronghold", "strong", "competitive", "weak", "very_weak"];

export const BASE_CLASS_LABEL: Record<BaseClass, string> = {
  stronghold: "Fortaleza eleitoral",
  strong: "Forte",
  competitive: "Competitivo",
  weak: "Fraco",
  very_weak: "Muito fraco",
};

/** Cor ordinal da classe (um matiz; nunca cor de marca nem de partido). */
export function baseClassColor(c: BaseClass, theme: DataTheme = "light"): string {
  const order: BaseClass[] = ["very_weak", "weak", "competitive", "strong", "stronghold"];
  return ORDINAL_5[theme][order.indexOf(c)];
}

export const HIGHLIGHT_LABEL: Record<keyof ElectoralBaseHighlights, string> = {
  strongest: "Onde é mais forte",
  weakest: "Onde é mais fraca",
  competitive: "Disputas mais apertadas",
  highestShare: "Maior participação",
  highestVolume: "Maior volume",
  growth: "Onde cresceu",
  decline: "Onde caiu",
  gainedPosition: "Ganhou posição",
  lostPosition: "Perdeu posição",
  critical: "Críticos",
};

const enc = encodeURIComponent;

export const baseApi = {
  base: (candidacyId: string, level: TerritoryLevel, opts: { uf?: string | null; municipality?: string | null; zone?: number | null } = {}) => {
    const params = new URLSearchParams({ level });
    if (opts.uf) params.set("uf", opts.uf);
    if (opts.municipality) params.set("municipality", opts.municipality);
    if (opts.zone != null) params.set("zone", String(opts.zone));
    return fetchJson<ElectoralBaseResponse>(`/api/v1/elections/candidacies/${enc(candidacyId)}/base?${params}`);
  },
};

/** "+3,2 p.p." / "−1,5 p.p." — margem ou variação em pontos percentuais. */
export function points(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p.`;
}

export const scoreText = (score: number | null) =>
  score === null ? "—" : score.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
