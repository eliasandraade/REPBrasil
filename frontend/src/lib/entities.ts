import type { Indicator, IndicatorValue } from "./data-intelligence";
import type { MunicipalityDetailResponse, StateItem } from "./elections/types";
import type { OfficeRef } from "./overview";

export const PREFERRED_INDICATOR_CODES = [
  "ibge.population",
  "derived.illiteracy_rate_15_plus",
  "ibge.literacy_rate_15_plus",
  "derived.gdp_per_capita",
  "ibge.gdp_total",
  "atlas.idhm",
] as const;

export interface StateElectionSnapshot {
  year: number;
  round: number;
  electionDate: string;
  description: string | null;
  default: boolean;
  state: StateItem;
}

export interface MunicipalityElectionSnapshot {
  year: number;
  round: number;
  electionDate: string;
  description: string | null;
  default: boolean;
  detail: MunicipalityDetailResponse;
}

export interface ProfileIndicator {
  indicator: Indicator;
  value: IndicatorValue;
}

export interface IndicatorCoverage {
  indicator: Indicator;
  period: number;
  observed: number;
}

export function stateProfilePath(uf: string): string {
  return `/estados/${encodeURIComponent(uf.trim().toLowerCase())}`;
}

export function municipalityProfilePath(uf: string, municipality: string): string {
  return `/municipios/${encodeURIComponent(uf.trim().toLowerCase())}/${encodeURIComponent(municipality.trim().toLowerCase())}`;
}

export function electionProfilePath(year: number, round: number): string {
  return `/eleicoes/${year}/${round}`;
}

export function sortElectionSnapshots<T extends { year: number; round: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.year - a.year || b.round - a.round);
}

export function isMunicipalOffice(office: number): boolean {
  return office === 11 || office === 12 || office === 13;
}

/** Escolha determinística para o resumo: cargo titular mais útil ao público, nunca vice/suplente. */
export function chooseFeaturedOffice(year: number, offices: readonly OfficeRef[]): OfficeRef | null {
  if (offices.length === 0) return null;
  const preferred = year % 4 === 0 ? [11, 13] : [6, 7, 5, 3, 1, 8];
  for (const code of preferred) {
    const match = offices.find((office) => office.code === code);
    if (match) return match;
  }
  return offices[0] ?? null;
}

export function indicatorValueText(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "%") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (/pessoa/i.test(unit)) return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}
