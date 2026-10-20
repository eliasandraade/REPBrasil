import { formatCoefficient, formatInteger } from "./format";

/**
 * Leituras em linguagem simples, calculadas só dos dados exibidos. Nenhuma frase avalia território, pessoa ou
 * candidatura: descreve posição, faixa e associação, e diz o que a associação não prova.
 */

export interface Observation {
  code: string;
  name: string;
  value: number;
}

export interface Distribution {
  n: number;
  min: Observation;
  max: Observation;
  median: number;
}

export function distribution(rows: readonly Observation[]): Distribution | null {
  const finite = rows.filter((r) => Number.isFinite(r.value));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, "pt-BR"));
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle].value : (sorted[middle - 1].value + sorted[middle].value) / 2;
  return { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median };
}

/** Posição do território do maior para o menor valor (1 = maior); empates dividem a posição. */
export function rankOf(rows: readonly Observation[], code: string): { rank: number; n: number } | null {
  const target = rows.find((r) => r.code === code && Number.isFinite(r.value));
  if (!target) return null;
  const finite = rows.filter((r) => Number.isFinite(r.value));
  return { rank: 1 + finite.filter((r) => r.value > target.value).length, n: finite.length };
}

export type Strength = "sem_associacao" | "fraca" | "moderada" | "forte" | "perfeita";

export function strengthOf(coefficient: number | null): Strength | null {
  if (coefficient === null || !Number.isFinite(coefficient)) return null;
  const r = Math.abs(coefficient);
  if (r >= 0.99) return "perfeita";
  if (r >= 0.5) return "forte";
  if (r >= 0.3) return "moderada";
  if (r >= 0.1) return "fraca";
  return "sem_associacao";
}

export const STRENGTH_LABEL: Record<Strength, string> = {
  sem_associacao: "sem associação clara",
  fraca: "associação fraca",
  moderada: "associação moderada",
  forte: "associação forte",
  perfeita: "associação praticamente perfeita",
};

/**
 * A associação em uma frase, a partir do Spearman (postos: robusto a valores extremos, como a capital). Os nomes
 * entram como rótulos do catálogo ("com maior População"), o que mantém a frase correta para qualquer indicador.
 * Associação perfeita costuma ser construção (um indicador calculado a partir do outro), e a frase diz isso.
 */
export function associationSentence(xName: string, yName: string, spearman: number | null, n: number): string {
  const strength = strengthOf(spearman);
  const where = `nos ${formatInteger(n)} municípios com os dois dados`;
  if (strength === null || spearman === null) return `Não há variação suficiente ${where} para medir associação entre ${xName} e ${yName}.`;
  const rho = `ρ = ${formatCoefficient(spearman)}`;
  if (strength === "sem_associacao") return `Não há associação clara entre ${xName} e ${yName} ${where} (${rho}).`;
  const direction = spearman > 0 ? "maior" : "menor";
  const sentence = `Nos ${formatInteger(n)} municípios com os dois dados, os que têm maior ${xName} tendem a ter ${direction} ${yName} (${STRENGTH_LABEL[strength]}, ${rho}).`;
  return strength === "perfeita"
    ? `${sentence} Em geral, isso indica que um indicador é calculado a partir do outro, e não é uma descoberta.`
    : sentence;
}

export interface ExtremeGroup {
  n: number;
  xFrom: number;
  xTo: number;
  meanY: number;
}

/**
 * Compara os municípios no topo e na base de X (cada grupo com `share` dos municípios): média de Y em cada um.
 * É uma leitura territorial — descreve municípios, não pessoas.
 */
export function extremeGroups(
  points: ReadonlyArray<{ x: number; y: number; municipalityIbgeCode: string }>,
  share = 0.2,
): { low: ExtremeGroup; high: ExtremeGroup } | null {
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const size = Math.floor(finite.length * share);
  if (size < 2) return null;
  const sorted = [...finite].sort((a, b) => a.x - b.x || a.municipalityIbgeCode.localeCompare(b.municipalityIbgeCode));
  const group = (rows: typeof sorted): ExtremeGroup => ({
    n: rows.length,
    xFrom: rows[0].x,
    xTo: rows[rows.length - 1].x,
    meanY: rows.reduce((sum, p) => sum + p.y, 0) / rows.length,
  });
  return { low: group(sorted.slice(0, size)), high: group(sorted.slice(-size)) };
}
