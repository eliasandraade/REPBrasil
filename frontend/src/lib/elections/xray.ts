import { fetchJson } from "../api";
import { UNAVAILABLE } from "./format";
import type {
  CandidacyAssetsResponse,
  CandidacyFinanceResponse,
  CandidacyTerritoryResponse,
  CellState,
  ComparisonResponse,
  ContestComparability,
  MapLayerKind,
  MapLayerResponse,
  TerritoryCandidatesResponse,
  TerritoryComparability,
  TerritoryLevel,
  XrayResponse,
} from "./xray-types";

const enc = encodeURIComponent;

/** Limite da comparação, imposto aqui e na API (400 acima disso). */
export const MAX_COMPARE = 5;

function query(params: Record<string, string | number | boolean | null | undefined | Array<string>>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface CandidatesFilters {
  municipality?: string | null;
  zone?: number | null;
  office?: number | null;
  party?: string | null;
  q?: string | null;
  status?: string | null;
  elected?: boolean | null;
  minVotes?: number | null;
  sort?: "votes" | "share" | "name" | "number" | "party" | "office";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface MapLayerParams {
  layer: MapLayerKind;
  office?: number | null;
  candidacy?: string | null;
  base?: string | null;
  a?: string | null;
  b?: string | null;
  municipality?: string | null;
}

export class CompareLimitError extends Error {
  constructor() {
    super(`Compare no máximo ${MAX_COMPARE} candidaturas.`);
    this.name = "CompareLimitError";
  }
}

export const xrayApi = {
  xray: (politicianId: string) => fetchJson<XrayResponse>(`/api/v1/politicians/${enc(politicianId)}/xray`),
  territory: (candidacyId: string, level: TerritoryLevel, opts: { uf?: string | null; municipality?: string | null; zone?: number | null } = {}) =>
    fetchJson<CandidacyTerritoryResponse>(
      `/api/v1/elections/candidacies/${enc(candidacyId)}/territory${query({ level, uf: opts.uf, municipality: opts.municipality, zone: opts.zone })}`,
    ),
  assets: (candidacyId: string, compareTo?: string | null) =>
    fetchJson<CandidacyAssetsResponse>(`/api/v1/elections/candidacies/${enc(candidacyId)}/assets${query({ compareTo })}`),
  finance: (candidacyId: string) => fetchJson<CandidacyFinanceResponse>(`/api/v1/elections/candidacies/${enc(candidacyId)}/finance`),
  candidates: (year: number, round: number, uf: string, f: CandidatesFilters = {}) =>
    fetchJson<TerritoryCandidatesResponse>(
      `/api/v1/elections/${year}/${round}/states/${enc(uf.toUpperCase())}/candidates${query({ ...f })}`,
    ),
  map: (year: number, round: number, uf: string, p: MapLayerParams) =>
    fetchJson<MapLayerResponse>(`/api/v1/elections/${year}/${round}/states/${enc(uf.toUpperCase())}/map${query({ ...p })}`),
  compare: (candidacyIds: string[], opts: { uf: string; level: TerritoryLevel; municipality?: string | null; zone?: number | null }) => {
    const ids = [...new Set(candidacyIds)];
    if (ids.length === 0 || ids.length > MAX_COMPARE) return Promise.reject(new CompareLimitError());
    return fetchJson<ComparisonResponse>(
      `/api/v1/elections/compare${query({ candidacy: ids, uf: opts.uf.toUpperCase(), level: opts.level, municipality: opts.municipality, zone: opts.zone })}`,
    );
  },
};

// ── Seleção de comparação (URL: ?c=id1,id2,…) ─────────────────────────────────

export function parseSelection(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, MAX_COMPARE);
}

export const serializeSelection = (ids: string[]) => ids.join(",");

export type ToggleResult = { ids: string[]; rejected: boolean };

/** Adiciona/remove da seleção; a 6ª candidatura é recusada (nunca descarta outra em silêncio). */
export function toggleSelection(ids: string[], id: string): ToggleResult {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), rejected: false };
  if (ids.length >= MAX_COMPARE) return { ids, rejected: true };
  return { ids: [...ids, id], rejected: false };
}

// ── Rótulos (pt-BR) ──────────────────────────────────────────────────────────

export const CELL_STATE_LABEL: Record<CellState, string> = {
  value: "votos apurados",
  zero: "zero voto (BU apurado)",
  outside_contest: "fora da disputa",
  no_coverage: "sem Boletim de Urna",
  partial_coverage: "cobertura parcial",
  not_on_ballot: "fora da urna",
  unlinked: "sem vínculo auditado",
  ticket_member: "votado(a) na chapa",
  absent: "sem candidatura",
};

export const CONTEST_COMPARABILITY_LABEL: Record<ContestComparability, string> = {
  comparable_contest: "disputa comparável",
  different_office: "cargo diferente",
  different_territorial_scope: "abrangência territorial diferente",
  direct_comparison_unavailable: "comparação direta indisponível",
};

export const TERRITORY_COMPARABILITY_LABEL: Record<TerritoryComparability, string> = {
  comparable: "comparável",
  section_composition_changed: "composição da seção mudou",
  coverage_or_section_missing: "sem cobertura ou seção inexistente",
};

export function comparabilityLabel(value: string): string {
  return (
    (CONTEST_COMPARABILITY_LABEL as Record<string, string>)[value] ??
    (TERRITORY_COMPARABILITY_LABEL as Record<string, string>)[value] ??
    value
  );
}

export const LEVEL_LABEL: Record<TerritoryLevel, string> = {
  state: "Estado",
  municipality: "Município",
  zone: "Zona",
  section: "Seção",
  place: "Local de votação",
};

export const LEVEL_PLURAL: Record<TerritoryLevel, string> = {
  state: "Estados",
  municipality: "Municípios",
  zone: "Zonas",
  section: "Seções",
  place: "Locais de votação",
};

/** "1 seção", "3 seções", "2 locais de votação". */
export const levelCount = (level: TerritoryLevel, n: number) =>
  `${n.toLocaleString("pt-BR")} ${(n === 1 ? LEVEL_LABEL[level] : LEVEL_PLURAL[level]).toLowerCase()}`;

/** Valor de votos com o estado: nunca escreve 0 quando o estado não afirma contagem. */
export function votesText(votes: number | null, state: CellState): string {
  if (votes === null || votes === undefined) return state === "value" || state === "zero" ? UNAVAILABLE : CELL_STATE_LABEL[state] ?? UNAVAILABLE;
  return votes.toLocaleString("pt-BR");
}

function withSign(n: number, abs: string): string {
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNAVAILABLE;
  return withSign(n, Math.abs(n).toLocaleString("pt-BR"));
}

export function signedPercent(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return UNAVAILABLE;
  return `${withSign(p, Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: 2 }))}%`;
}

export function money(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? UNAVAILABLE
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const electionLabel = (year: number, round: number) => (round === 1 ? String(year) : `${year} · 2º turno`);
