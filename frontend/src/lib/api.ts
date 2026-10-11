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

/** Mensagem legível do corpo de erro da API (`{ message }` ou ProblemDetails), sem o prefixo técnico. */
export function apiErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.message.indexOf(" — ");
  if (body < 0) return null;
  try {
    const parsed = JSON.parse(error.message.slice(body + 3)) as { message?: unknown; detail?: unknown; title?: unknown };
    const text = [parsed.message, parsed.detail, parsed.title].find((v) => typeof v === "string" && v.trim());
    return typeof text === "string" ? text : null;
  } catch {
    return null;
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
  return fetchJson<PoliticianDetail>(`/api/v1/politicians/${encodeURIComponent(id)}`);
}

export function getPoliticianBySlug(slug: string): Promise<PoliticianDetail> {
  return fetchJson<PoliticianDetail>(`/api/v1/politicians/slug/${encodeURIComponent(slug)}`);
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
