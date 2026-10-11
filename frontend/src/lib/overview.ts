/** Cobertura atual da plataforma (GET /api/v1/overview): só o que está importado, nunca promessa. */
import { fetchJson } from "./api";
import { buildElectionsPath } from "./elections/route";

export interface OfficeRef {
  code: number;
  name: string;
}

export interface CoverageElection {
  year: number;
  round: number;
  uf: string;
  stateName: string;
  municipalities: number;
  zones: number;
  sections: number;
  eligible: number;
  offices: OfficeRef[];
}

export interface OverviewSource {
  kind: string;
  publisher: string;
  label: string;
  files: number;
  latestDownload: string | null;
}

export interface OverviewResponse {
  elections: CoverageElection[];
  candidacies: number;
  politicians: number;
  sources: OverviewSource[];
  updatedAt: string | null;
}

export const getOverview = (signal?: AbortSignal) => fetchJson<OverviewResponse>("/api/v1/overview", { signal });

export const coverageHref = (e: CoverageElection) =>
  buildElectionsPath({ year: e.year, round: e.round, state: e.uf.toLowerCase() });

/** 6.996.545 → "7,0 milhões"; abaixo de 1 milhão, o número inteiro. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} milhões`;
  return n.toLocaleString("pt-BR");
}

/** "Presidente, Governador e Senador". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** Data ISO → "10/10/2026" no fuso de Brasília; inválida → null. */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Pleitos agrupados por ano (mais recente primeiro), turnos em ordem. */
export function byYear(elections: CoverageElection[]): { year: number; rounds: CoverageElection[] }[] {
  const years = [...new Set(elections.map((e) => e.year))].sort((a, b) => b - a);
  return years.map((year) => ({
    year,
    rounds: elections.filter((e) => e.year === year).sort((a, b) => a.round - b.round || a.uf.localeCompare(b.uf)),
  }));
}
