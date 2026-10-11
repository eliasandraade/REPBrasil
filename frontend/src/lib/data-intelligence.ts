import { fetchJson } from "./api";

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
