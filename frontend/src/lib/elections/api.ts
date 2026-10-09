import { fetchJson } from "../api";
import type {
  CandidacyItem,
  ElectionsResponse,
  MunicipalitiesResponse,
  MunicipalityDetailResponse,
  PoliticianCandidaciesResponse,
  SectionResultsResponse,
  StatesResponse,
  ZoneDetailResponse,
} from "./types";

const base = (year: number, round: number) => `/api/v1/elections/${year}/${round}`;
const enc = encodeURIComponent;

export interface ResultQuery {
  office?: number;
  candidate?: number;
  party?: number;
  voteType?: "nominal" | "legenda" | "branco" | "nulo";
}

export const electionsApi = {
  elections: () => fetchJson<ElectionsResponse>("/api/v1/elections"),
  states: (year: number, round: number) => fetchJson<StatesResponse>(`${base(year, round)}/states`),
  municipalities: (year: number, round: number, uf: string, q?: string) =>
    fetchJson<MunicipalitiesResponse>(
      `${base(year, round)}/states/${enc(uf)}/municipalities${q ? `?q=${enc(q)}` : ""}`,
    ),
  municipality: (year: number, round: number, uf: string, municipality: string) =>
    fetchJson<MunicipalityDetailResponse>(`${base(year, round)}/states/${enc(uf)}/municipalities/${enc(municipality)}`),
  zone: (year: number, round: number, uf: string, municipality: string, zone: number) =>
    fetchJson<ZoneDetailResponse>(
      `${base(year, round)}/states/${enc(uf)}/municipalities/${enc(municipality)}/zones/${zone}`,
    ),
  sectionResults: (
    year: number,
    round: number,
    uf: string,
    municipality: string,
    zone: number,
    section: number,
    query: ResultQuery = {},
  ) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.set(k, String(v));
    const qs = params.toString();
    return fetchJson<SectionResultsResponse>(
      `${base(year, round)}/states/${enc(uf)}/municipalities/${enc(municipality)}/zones/${zone}/sections/${section}/results${qs ? `?${qs}` : ""}`,
    );
  },
  candidacy: (id: string) => fetchJson<CandidacyItem>(`/api/v1/elections/candidacies/${enc(id)}`),
  politicianCandidacies: (politicianId: string, top = 5) =>
    fetchJson<PoliticianCandidaciesResponse>(`/api/v1/politicians/${enc(politicianId)}/candidacies?top=${top}`),
};
