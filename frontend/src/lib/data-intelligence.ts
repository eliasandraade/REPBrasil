import { accountFetch } from "./account";
import { API_URL, ApiError, fetchJson } from "./api";

export interface Indicator {
  code: string;
  name: string;
  unit: string;
  provider: string;
  description: string;
  derived: boolean;
}

export interface IndicatorValue {
  indicatorCode: string;
  municipalityIbgeCode: string;
  municipalityName: string;
  period: number;
  value: number;
  provider: string;
  dataset: string;
  retrievedAt: string;
}

export interface CorrelationPoint {
  municipalityIbgeCode: string;
  municipalityName: string;
  x: number;
  y: number;
}

export interface CorrelationResponse {
  xIndicator: string;
  yMetric: string;
  period: number;
  n: number;
  pearson: number | null;
  spearman: number | null;
  points: CorrelationPoint[];
  methodology: string;
  caveat: string;
}

export interface ClusterItem {
  municipalityIbgeCode: string;
  municipalityName: string;
  value: number;
  cluster: number;
}

export interface ClusterResponse {
  indicator: string;
  period: number;
  k: number;
  centroids: number[];
  items: ClusterItem[];
  methodology: string;
}

export interface CandidacyCorrelationParams {
  xIndicator: string;
  period: number;
  candidacyId: string;
  year: number;
  round: number;
  office: number;
  uf: string;
}

/** Indicador com valor carregado num período: quantos municípios da UF têm observação. */
export interface IndicatorCoverage {
  indicator: string;
  period: number;
  municipalities: number;
}

/** Pleito com resultado (Boletim de Urna) carregado. */
export interface ElectionCoverage {
  year: number;
  round: number;
  municipalities: number;
}

/** Ano com emendas na edição vigente: emendas e municípios identificados por código IBGE oficial. */
export interface AmendmentCoverage {
  year: number;
  municipalities: number;
  amendments: number;
}

/** O que está carregado numa UF. Lista vazia = nada carregado naquele domínio. */
export interface StateCoverage {
  uf: string;
  name: string;
  ibgeCode: number | null;
  municipalities: number;
  socioeconomic: IndicatorCoverage[];
  elections: ElectionCoverage[];
  amendments: AmendmentCoverage[];
}

export interface DataCoverage {
  states: StateCoverage[];
}

export interface MatrixIndicator {
  code: string;
  name: string;
  unit: string;
  n: number;
}

export interface MatrixCell {
  x: string;
  y: string;
  n: number;
  pearson: number | null;
  spearman: number | null;
}

export interface CorrelationMatrix {
  uf: string;
  period: number;
  indicators: MatrixIndicator[];
  cells: MatrixCell[];
  methodology: string;
  caveat: string;
}

export function getCoverage(): Promise<DataCoverage> {
  return fetchJson<DataCoverage>("/api/v1/data/coverage");
}

/** Matriz de correlação da UF (plano com `data.correlation_matrix`; a API decide e recusa com 403). */
export function getCorrelationMatrix(uf: string, period: number): Promise<CorrelationMatrix> {
  return accountFetch<CorrelationMatrix>(`/api/v1/data/correlation-matrix?${new URLSearchParams({ uf, period: String(period) })}`);
}

/** Nome do arquivo igual ao da API: só letras, dígitos, ponto e hífen. */
export function exportFileName(subject: string, uf: string, period?: number | null): string {
  const part = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9.]/g, "-");
  return ["repbrasil", subject, uf, period ? String(period) : ""].filter(Boolean).map(part).join("-") + ".csv";
}

/**
 * Baixa um CSV autenticado. O arquivo vem pronto da API (proveniência em cada linha); recusa de plano chega como
 * `ApiError` 403 com o corpo da API, para a interface explicar o motivo.
 */
async function downloadCsv(path: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", headers: { Accept: "text/csv" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` — ${body}` : "";
    throw new ApiError(response.status, `API error ${response.status}: ${path}${detail}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV do recorte (um indicador numa UF e período), plano com `data.export_csv`. */
export function downloadIndicatorCsv(indicator: string, uf: string, period: number | null): Promise<void> {
  const query = new URLSearchParams({ indicator, uf });
  if (period) query.set("period", String(period));
  return downloadCsv(`/api/v1/data/export?${query}`, exportFileName(indicator, uf, period));
}

/** CSV com todos os indicadores carregados da UF, plano com `data.export_bulk`. */
export function downloadStateCsv(uf: string, period: number | null): Promise<void> {
  const query = new URLSearchParams({ uf });
  if (period) query.set("period", String(period));
  return downloadCsv(`/api/v1/data/export/bulk?${query}`, exportFileName("indicadores", uf, period));
}

export function getIndicators(): Promise<Indicator[]> {
  return fetchJson<Indicator[]>("/api/v1/data/indicators");
}

export function getIndicatorValues(indicator: string, period?: number, uf?: string): Promise<IndicatorValue[]> {
  const params = new URLSearchParams({ indicator });
  if (period !== undefined) params.set("period", String(period));
  if (uf) params.set("uf", uf);
  return fetchJson<IndicatorValue[]>(`/api/v1/data/values?${params}`);
}

export function getCorrelation(xIndicator: string, yIndicator: string, period: number, uf?: string): Promise<CorrelationResponse> {
  const params = new URLSearchParams({ xIndicator, yIndicator, period: String(period) });
  if (uf) params.set("uf", uf);
  return fetchJson<CorrelationResponse>(`/api/v1/data/correlation?${params}`);
}

export function getCandidacyCorrelation(params: CandidacyCorrelationParams): Promise<CorrelationResponse> {
  const query = new URLSearchParams({
    xIndicator: params.xIndicator,
    period: String(params.period),
    candidacyId: params.candidacyId,
    year: String(params.year),
    round: String(params.round),
    office: String(params.office),
    uf: params.uf,
  });
  return fetchJson<CorrelationResponse>(`/api/v1/data/correlation?${query}`);
}

export function getClusters(indicator: string, period: number, k = 3, uf?: string): Promise<ClusterResponse> {
  const params = new URLSearchParams({ indicator, period: String(period), k: String(k) });
  if (uf) params.set("uf", uf);
  return fetchJson<ClusterResponse>(`/api/v1/data/clusters?${params}`);
}
