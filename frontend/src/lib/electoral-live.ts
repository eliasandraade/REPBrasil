import { fetchJson } from "./api";

export interface PollOption {
  order: number;
  label: string;
  kind: "candidate" | "blank_null" | "undecided" | "other";
  candidacyId: string | null;
  partyAcronym: string | null;
  percentage: number | null;
}

export interface PollScenario {
  name: string;
  order: number;
  options: PollOption[];
}

export interface ElectoralPoll {
  id: string;
  registrationNumber: string;
  institute: string;
  fieldStart: string;
  fieldEnd: string;
  publishedAt: string | null;
  sampleSize: number | null;
  marginErrorPp: number | null;
  confidenceLevel: number | null;
  methodology: string | null;
  sourceUrl: string;
  retrievedAt: string;
  scenarios: PollScenario[];
}

export interface PollsResponse {
  year: number;
  round: number;
  office: number;
  uf: string | null;
  municipalityTseCode: string | null;
  polls: ElectoralPoll[];
  methodology: string;
  caveat: string;
}

export interface LiveCountItem {
  position: number;
  candidacyId: string | null;
  candidateNumber: number | null;
  label: string;
  partyAcronym: string | null;
  votes: number | null;
  percentage: number | null;
  resultStatus: string | null;
}

export interface LiveCountSnapshot {
  snapshotId: string;
  scope: "national" | "state" | "municipal";
  status: "not_started" | "partial" | "final";
  countedSections: number | null;
  totalSections: number | null;
  countedPercent: number | null;
  capturedAt: string;
  tseGeneratedAt: string | null;
  sourceUrl: string;
  results: LiveCountItem[];
}

export interface LiveCountResponse {
  year: number;
  round: number;
  office: number;
  uf: string | null;
  municipalityTseCode: string | null;
  snapshot: LiveCountSnapshot | null;
  methodology: string;
  caveat: string;
}

export interface ElectoralLiveQuery {
  year: number;
  round: number;
  office: number;
  uf?: string;
  municipalityTseCode?: string;
}

function queryString(query: ElectoralLiveQuery) {
  const params = new URLSearchParams({
    year: String(query.year),
    round: String(query.round),
    office: String(query.office),
  });
  if (query.uf) params.set("uf", query.uf);
  if (query.municipalityTseCode) params.set("municipalityTseCode", query.municipalityTseCode);
  return params.toString();
}

export function getPolls(query: ElectoralLiveQuery): Promise<PollsResponse> {
  return fetchJson<PollsResponse>(`/api/v1/elections/polls?${queryString(query)}`);
}

export function getLiveCount(query: ElectoralLiveQuery): Promise<LiveCountResponse> {
  return fetchJson<LiveCountResponse>(`/api/v1/elections/live?${queryString(query)}`);
}
