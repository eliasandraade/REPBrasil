import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, PagedResult, PoliticianDetail, PoliticianSummary, ScoreStatusItem, SearchFilters } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${path}${body ? ` — ${body}` : ""}`);
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
