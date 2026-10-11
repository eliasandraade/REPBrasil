import { fetchJson } from "@/lib/api";
import type { Freshness } from "@/lib/elections/xray-types";
import type { RankingCoverage } from "@/lib/rankings";

/** Partidos (GET /api/v1/parties, /api/v1/parties/{slug}). Espelha os DTOs de RepBrasil.Application.Parties. */

export interface PartyChange {
  fromYear: number;
  fromRound: number;
  fromPartyNumber: number;
  fromVotes: number | null;
  fromShare: number | null;
  fromElected: number;
  deltaVotes: number | null;
  deltaPercent: number | null;
  deltaSharePoints: number | null;
  comparability: "comparable" | "coverage_incomplete" | "absent";
  note: string;
}

export interface PartyResult {
  year: number;
  round: number;
  officeCode: number;
  officeName: string;
  partyNumber: number;
  federations: string | null;
  votes: number | null;
  nominalVotes: number | null;
  legendVotes: number | null;
  validVotes: number | null;
  share: number | null;
  candidacies: number;
  elected: number;
  municipalitiesWithVotes: number;
  municipalitiesCovered: number;
  change: PartyChange | null;
}

export interface PartySummary {
  slug: string;
  acronym: string;
  name: string | null;
  numbers: number[];
  results: PartyResult[];
}

export interface PartyElection {
  year: number;
  round: number;
  offices: Array<{ code: number; name: string; covered: boolean }>;
}

export interface PartiesResponse {
  uf: string;
  elections: PartyElection[];
  parties: PartySummary[];
  methodology: string;
  definitions: Record<string, string>;
  freshness: Freshness;
}

export interface PartyTerritory {
  municipalityTseCode: string;
  name: string;
  slug: string | null;
  zone: number | null;
  votes: number;
  validVotes: number;
  share: number | null;
  candidacies: number | null;
  elected: number | null;
}

export interface PartyCandidate {
  candidacyId: string;
  politicianId: string | null;
  slug: string | null;
  name: string;
  number: number;
  unit: string | null;
  votes: number | null;
  elected: boolean | null;
  outcome: string | null;
}

export interface PartyDetail {
  year: number;
  round: number;
  officeCode: number;
  officeName: string;
  partyNumbers: number[];
  strongest: PartyTerritory[];
  weakest: PartyTerritory[];
  territoriesWithVotes: number;
  territoriesConsidered: number;
  candidates: PartyCandidate[];
  coverage: RankingCoverage | null;
  note: string;
}

export interface PartyProfileResponse {
  slug: string;
  acronym: string;
  name: string | null;
  uf: string;
  identity: Array<{ year: number; round: number; number: number; acronym: string; name: string | null; federations: string | null }>;
  results: PartyResult[];
  detail: PartyDetail | null;
  notes: string[];
  methodology: string;
  definitions: Record<string, string>;
  freshness: Freshness;
}

const enc = encodeURIComponent;

export const partiesApi = {
  list: (uf: string) => fetchJson<PartiesResponse>(`/api/v1/parties?uf=${enc(uf)}`),
  profile: (slug: string, uf: string, pick: { year?: number | null; round?: number | null; office?: number | null } = {}) => {
    const p = new URLSearchParams({ uf });
    if (pick.year != null) p.set("year", String(pick.year));
    if (pick.round != null) p.set("round", String(pick.round));
    if (pick.office != null) p.set("office", String(pick.office));
    return fetchJson<PartyProfileResponse>(`/api/v1/parties/${enc(slug)}?${p}`);
  },
};

export const partyPath = (slug: string) => `/partidos/${enc(slug)}`;

/** Resultado do partido numa eleição × cargo (undefined = o partido não disputou). */
export function resultFor(p: PartySummary, year: number, round: number, office: number): PartyResult | undefined {
  return p.results.find((r) => r.year === year && r.round === round && r.officeCode === office);
}

/** Primeira escolha de eleição × cargo: eleição mais recente com BU, cargo com mais votos no conjunto. */
export function defaultPick(data: PartiesResponse): { year: number; round: number; office: number } | null {
  for (const e of data.elections) {
    const covered = e.offices.filter((o) => o.covered);
    if (covered.length === 0) continue;
    return { year: e.year, round: e.round, office: covered[0].code };
  }
  const first = data.elections[0];
  return first && first.offices[0] ? { year: first.year, round: first.round, office: first.offices[0].code } : null;
}
