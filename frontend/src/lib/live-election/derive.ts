import { normalizeText } from "@/lib/elections/format";
import type {
  CandidateSlot,
  CandidateVotes,
  LiveCandidate,
  RegionCode,
  RemainingByUf,
  TerritoryResult,
} from "./types";

/**
 * Leituras derivadas do contrato para a apresentação. Nenhuma regra eleitoral é recalculada aqui: votos,
 * percentuais, líder e vantagem vêm prontos da API (TSE ou agregação absoluta do backend). Estas funções só
 * localizam, ordenam e classificam para exibir.
 */

export const REGION_LABEL: Readonly<Record<RegionCode, string>> = {
  N: "Norte",
  NE: "Nordeste",
  CO: "Centro-Oeste",
  SE: "Sudeste",
  S: "Sul",
};

export const EXTERIOR_CODE = "ZZ";

export function candidateByKey(candidates: readonly LiveCandidate[], key: string | null | undefined): LiveCandidate | null {
  if (!key) return null;
  return candidates.find((c) => c.key === key) ?? null;
}

export function slotOf(candidates: readonly LiveCandidate[], key: string | null | undefined): CandidateSlot | null {
  return candidateByKey(candidates, key)?.slot ?? null;
}

export function votesOf(territory: Pick<TerritoryResult, "candidates"> | null | undefined, key: string): CandidateVotes | null {
  return territory?.candidates.find((c) => c.key === key) ?? null;
}

/** Território com votos de candidatos publicados (dado disponível e alguma votação). */
export function hasVotes(territory: TerritoryResult | null | undefined): territory is TerritoryResult {
  if (!territory?.available) return false;
  return territory.candidates.some((c) => typeof c.votes === "number" && c.votes > 0);
}

/**
 * Classe de intensidade do mapa pela vantagem em pontos percentuais: 0 (até 5 p.p.), 1 (5–10), 2 (10–20),
 * 3 (acima de 20). Só intensidade visual; a legenda explica as faixas.
 */
export const LEAD_CLASS_LIMITS = [5, 10, 20] as const;

export function leadClass(leadPp: number | null | undefined): 0 | 1 | 2 | 3 {
  const v = Math.abs(leadPp ?? 0);
  if (v < LEAD_CLASS_LIMITS[0]) return 0;
  if (v < LEAD_CLASS_LIMITS[1]) return 1;
  if (v < LEAD_CLASS_LIMITS[2]) return 2;
  return 3;
}

export const LEAD_CLASS_LABEL = ["até 5 p.p.", "5 a 10 p.p.", "10 a 20 p.p.", "mais de 20 p.p."] as const;

/** Situação de um território no mapa: líder (por slot), empate ou sem votação. */
export type TerritoryStanding = { kind: "lead"; slot: CandidateSlot; intensity: 0 | 1 | 2 | 3 } | { kind: "tie" } | { kind: "none" };

export function standingOf(territory: TerritoryResult | null | undefined, candidates: readonly LiveCandidate[]): TerritoryStanding {
  if (!hasVotes(territory)) return { kind: "none" };
  const slot = slotOf(candidates, territory.leaderKey);
  if (!slot) return { kind: "tie" };
  return { kind: "lead", slot, intensity: leadClass(territory.leadPp) };
}

/** Busca sem acento e sem caixa ("sao paulo" encontra "SÃO PAULO"). */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return normalizeText(text).includes(q);
}

/** UFs com menor percentual de seções totalizadas primeiro (só as que ainda não terminaram). */
export function lastToTotalize(remaining: readonly RemainingByUf[], limit = 8): RemainingByUf[] {
  return remaining
    .filter((r) => typeof r.totalizedPct === "number" && r.totalizedPct < 100)
    .sort((a, b) => (a.totalizedPct ?? 0) - (b.totalizedPct ?? 0) || (b.remainingUpperBound ?? 0) - (a.remainingUpperBound ?? 0))
    .slice(0, limit);
}

/** UFs com maior teto de eleitorado restante primeiro. */
export function byRemaining(remaining: readonly RemainingByUf[]): RemainingByUf[] {
  return [...remaining].sort((a, b) => (b.remainingUpperBound ?? -1) - (a.remainingUpperBound ?? -1) || a.uf.localeCompare(b.uf));
}

export interface CompletenessIndicator {
  id: "sections" | "electorate-totalized" | "electorate-counted";
  label: string;
  description: string;
  pct: number | null;
}

/** Completude do resultado (seção 43): três indicadores separados, nenhum "score" combinado. */
export function completenessOf(national: TerritoryResult): CompletenessIndicator[] {
  return [
    {
      id: "sections",
      label: "Seções totalizadas",
      description: "Seções já totalizadas sobre o total de seções.",
      pct: national.sections.totalizedPct,
    },
    {
      id: "electorate-totalized",
      label: "Eleitorado de seções totalizadas",
      description: "Eleitores aptos das seções já totalizadas sobre o eleitorado total.",
      pct: national.electorate.inTotalizedPct,
    },
    {
      id: "electorate-counted",
      label: "Eleitorado de seções apuradas",
      description: "Eleitores aptos das seções apuradas sobre o eleitorado total.",
      pct: national.electorate.inCountedOfTotalPct,
    },
  ];
}

/** Iniciais para o substituto da foto ("LUIZ INÁCIO" → "LI"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/u.test(p));
  const letters = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts).map((p) => p.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

export type SortDirection = "asc" | "desc";

/** Comparador estável para colunas numéricas com `null` sempre no fim. */
export function compareNullable(a: number | string | null | undefined, b: number | string | null | undefined, dir: SortDirection): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const order = typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "pt-BR") : (a as number) - (b as number);
  return dir === "asc" ? order : -order;
}

/** Razão de vantagem: votos do 1º / votos do 2º (ex.: 1,08). null sem votos do 2º. */
export function leadRatio(leaderVotes: number | null | undefined, runnerUpVotes: number | null | undefined): number | null {
  if (typeof leaderVotes !== "number" || typeof runnerUpVotes !== "number" || runnerUpVotes <= 0) return null;
  return leaderVotes / runnerUpVotes;
}

/**
 * Margem matemática de segurança (vantagem − teto do eleitorado restante), exibida só enquanto a distância para
 * a irreversibilidade é publicada (> 0): quando o limite foi alcançado sem o sinal oficial md=e, a API retém a
 * distância e esta margem também não é exibida.
 */
export function safetyMarginOf(math: {
  leadVotes: number | null;
  remainingElectorateUpperBound: number | null;
  distanceToIrreversibility: number | null;
}): number | null {
  if (math.distanceToIrreversibility === null || math.leadVotes === null || math.remainingElectorateUpperBound === null) return null;
  return math.leadVotes - math.remainingElectorateUpperBound;
}

/**
 * Percentual de uma candidatura num território para EXIBIÇÃO: sem votos totalizados, "—" (null) — um 0,00% antes
 * da apuração pareceria resultado.
 */
export function shareOf(territory: TerritoryResult | null | undefined, key: string | undefined): number | null {
  if (!key || !hasVotes(territory)) return null;
  return votesOf(territory, key)?.pct ?? null;
}

/** Vantagem em p.p. para exibição (null sem votos totalizados). */
export function leadPpOf(territory: TerritoryResult | null | undefined): number | null {
  return hasVotes(territory) ? territory.leadPp : null;
}

/** Vantagem em votos para exibição (null sem votos totalizados). */
export function leadVotesOf(territory: TerritoryResult | null | undefined): number | null {
  return hasVotes(territory) ? territory.leadVotes : null;
}
