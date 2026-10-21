import type { TableRow } from "@/components/territory/TerritoryTable";
import type { StateCoverage } from "@/lib/data-intelligence";
import type { TerritoryMunicipality } from "@/lib/territories";
import { ofUf } from "@/lib/territory/places";
import type { KnownState, ReadingModel } from "../explorer-types";

export const SELECT = "focus-ring w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body-sm text-fg disabled:opacity-60";

/** Nome da UF (catálogo da cobertura) ou a sigla. */
export const ufLabel = (coverage: StateCoverage | null, uf: string | null) => coverage?.name ?? uf ?? "";

/** "do Ceará", "da Bahia", "de São Paulo" (para "municípios do Ceará"). */
export const ofPlace = (coverage: StateCoverage | null, uf: string | null) => ofUf(uf, ufLabel(coverage, uf));

/** Posição de cada território do maior para o menor valor (1 = maior); empates dividem a posição. */
export function ranksOf(rows: ReadonlyArray<{ code: string; value: number }>): Map<string, number> {
  const sorted = rows.filter((r) => Number.isFinite(r.value)).sort((a, b) => b.value - a.value);
  const ranks = new Map<string, number>();
  sorted.forEach((row, index) => {
    const previous = sorted[index - 1];
    ranks.set(row.code, previous?.value === row.value ? ranks.get(previous.code)! : index + 1);
  });
  return ranks;
}

/**
 * Linhas da tabela: todos os municípios conhecidos da UF (catálogo), com valor onde há observação. Município sem
 * observação aparece como "sem dado" — nunca some, nunca vira zero.
 */
export function municipalityRows<T extends { code: string; name: string }>(
  catalog: readonly TerritoryMunicipality[],
  observed: readonly T[],
  build: (row: T) => Pick<TableRow, "cells" | "sort">,
  missingKey: string,
  missingText = "sem dado",
): TableRow[] {
  const byCode = new Map(observed.map((o) => [o.code, o]));
  const names = new Map<string, string>();
  for (const m of catalog) names.set(m.ibgeCode, m.name);
  for (const o of observed) if (!names.has(o.code)) names.set(o.code, o.name);
  return [...names].map(([code, name]) => {
    const row = byCode.get(code);
    if (!row) return { code, name, cells: { [missingKey]: missingText }, sort: {}, missing: true };
    return { code, name, ...build(row) };
  });
}

/** Estado de uma consulta do React Query: valor em mãos, consultando ou falha. */
export function knownState(query: { data: unknown; isError: boolean }): KnownState {
  if (query.data !== undefined) return "ready";
  return query.isError ? "error" : "loading";
}

/** Painel enquanto a cobertura da UF não é conhecida: nunca "nada carregado" antes de saber. */
export function pendingReading(status: Exclude<KnownState, "ready">): ReadingModel {
  if (status === "loading") return { what: "Verificando o que está carregado nesta UF…", facts: [] };
  return { what: "Não foi possível verificar agora o que está carregado nesta UF.", facts: [], notice: "A malha municipal (IBGE) continua disponível para navegar." };
}

/** Texto de uma lista de escolha vazia: a ausência só aparece quando a cobertura é conhecida. */
export function emptyChoice(status: KnownState, absent: string): string {
  if (status === "ready") return absent;
  return status === "loading" ? "Carregando…" : "Indisponível agora";
}

/** "1 município" ou "N municípios". */
export const municipios = (n: number, format: (n: number) => string) => `${format(n)} ${n === 1 ? "município" : "municípios"}`;

/** "acima", "abaixo" ou "igual" à referência. */
export function relationTo(value: number, reference: number): "acima" | "abaixo" | "igual" {
  if (value > reference) return "acima";
  if (value < reference) return "abaixo";
  return "igual";
}
