import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, Mandate, PagedResult, PoliticianDetail, PoliticianSummary, ScoreStatusItem, SearchFilters } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/** Erro HTTP da API, com o status preservado (404 ≠ falha de rede ≠ dado vazio). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `API error ${res.status}: ${path}${body ? ` — ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function searchPoliticians(
  query: string,
  page: number,
  pageSize = 20,
  filters: SearchFilters = {},
): Promise<PagedResult<PoliticianSummary>> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (filters.state) params.set("state", filters.state);
  if (filters.party) params.set("party", filters.party);
  if (filters.office) params.set("office", filters.office);
  return fetchJson<PagedResult<PoliticianSummary>>(`/api/v1/politicians?${params}`);
}

export function getPolitician(id: string): Promise<PoliticianDetail> {
  return fetchJson<PoliticianDetail>(`/api/v1/politicians/${id}`);
}

export function getPoliticianElections(id: string): Promise<ElectionResultItem[]> {
  return fetchJson<ElectionResultItem[]>(`/api/v1/politicians/${id}/elections`);
}

export function getPoliticianAssets(id: string): Promise<AssetDeclarationItem[]> {
  return fetchJson<AssetDeclarationItem[]>(`/api/v1/politicians/${id}/assets`);
}

export function getPoliticianSources(id: string): Promise<DataSourceItem[]> {
  return fetchJson<DataSourceItem[]>(`/api/v1/politicians/${id}/sources`);
}

export function getPoliticianScore(id: string): Promise<ScoreStatusItem> {
  return fetchJson<ScoreStatusItem>(`/api/v1/politicians/${id}/score`);
}

export function getMandates(id: string): Promise<Mandate[]> {
  return fetchJson<Mandate[]>(`/api/v1/politicians/${id}/mandates`);
}
