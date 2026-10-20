import type { DataCoverage, StateCoverage } from "@/lib/data-intelligence";
import { formatInteger } from "./format";
import type { ExplorerMode } from "./url";

/**
 * Disponibilidade real, vinda de `GET /api/v1/data/coverage`. A interface nunca deduz cobertura: UF ausente da
 * resposta ou com lista vazia não tem dado carregado naquele modo.
 */

export const MODE_LABEL: Record<ExplorerMode, string> = {
  socioeconomico: "Socioeconômico",
  eleitoral: "Eleitoral",
  emendas: "Emendas",
};

export function stateOf(coverage: DataCoverage | undefined, uf: string | null): StateCoverage | null {
  if (!coverage || !uf) return null;
  return coverage.states.find((s) => s.uf === uf) ?? null;
}

export function hasData(state: StateCoverage | null | undefined, mode: ExplorerMode): boolean {
  if (!state) return false;
  if (mode === "socioeconomico") return state.socioeconomic.length > 0;
  if (mode === "eleitoral") return state.elections.length > 0;
  return state.amendments.some((a) => a.municipalities > 0);
}

export function statesWithData(coverage: DataCoverage | undefined, mode: ExplorerMode): StateCoverage[] {
  return (coverage?.states ?? []).filter((s) => hasData(s, mode));
}

/** Indicadores com valor na UF e seus períodos (do mais recente ao mais antigo). */
export function loadedIndicators(state: StateCoverage | null | undefined): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of state?.socioeconomic ?? []) map.set(row.indicator, [...(map.get(row.indicator) ?? []), row.period]);
  for (const [key, periods] of map) map.set(key, [...new Set(periods)].sort((a, b) => b - a));
  return map;
}

/** Anos com emenda identificada por município, do mais recente ao mais antigo. */
export function amendmentYears(state: StateCoverage | null | undefined): number[] {
  return (state?.amendments ?? []).filter((a) => a.municipalities > 0).map((a) => a.year).sort((a, b) => b - a);
}

/** Frase curta do que existe na UF para o modo (tooltip do mapa do Brasil e painel de leitura). */
export function availabilityText(state: StateCoverage | null | undefined, mode: ExplorerMode): string {
  if (!hasData(state, mode) || !state) return "sem dados carregados";
  if (mode === "socioeconomico") {
    const indicators = loadedIndicators(state);
    const periods = [...new Set([...indicators.values()].flat())].sort((a, b) => b - a);
    const count = indicators.size;
    return `${count} ${count === 1 ? "indicador" : "indicadores"} · ${periods.join(", ")}`;
  }
  if (mode === "eleitoral") {
    const pleitos = state.elections.map((e) => `${e.year} (${e.round}º turno)`);
    return `${formatInteger(state.elections.length)} ${state.elections.length === 1 ? "pleito" : "pleitos"}: ${pleitos.join(", ")}`;
  }
  const years = amendmentYears(state);
  return years.length > 1 ? `emendas de ${years[years.length - 1]} a ${years[0]}` : `emendas de ${years[0]}`;
}
