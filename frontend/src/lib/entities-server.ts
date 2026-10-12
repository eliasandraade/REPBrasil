import { cache } from "react";
import type { Indicator, IndicatorValue } from "./data-intelligence";
import {
  PREFERRED_INDICATOR_CODES,
  chooseFeaturedOffice,
  isMunicipalOffice,
  sortElectionSnapshots,
  type IndicatorCoverage,
  type MunicipalityElectionSnapshot,
  type ProfileIndicator,
  type StateElectionSnapshot,
} from "./entities";
import type {
  ElectionsResponse,
  MunicipalitiesResponse,
  MunicipalityDetailResponse,
  StateItem,
  StatesResponse,
} from "./elections/types";
import type { CoverageElection, OfficeRef, OverviewResponse } from "./overview";
import type { RankingResponse } from "./rankings";
import { serverFetch, serverJson } from "./server-api";

export interface FeaturedRankings {
  office: OfficeRef | null;
  candidateKind: "votes" | "share" | null;
  candidates: RankingResponse | null;
  parties: RankingResponse | null;
}

export interface StateProfileData {
  uf: string;
  name: string;
  ibgeCode: number | null;
  snapshots: StateElectionSnapshot[];
  latest: StateElectionSnapshot;
  municipalities: MunicipalitiesResponse | null;
  indicators: IndicatorCoverage[];
  rankings: FeaturedRankings;
  overview: CoverageElection | null;
}

export interface MunicipalityProfileData {
  uf: string;
  name: string;
  slug: string;
  tseCode: string;
  ibgeCode: number | null;
  snapshots: MunicipalityElectionSnapshot[];
  latest: MunicipalityElectionSnapshot;
  indicators: ProfileIndicator[];
  rankings: FeaturedRankings;
  overview: CoverageElection | null;
  unavailableElections: number;
}

export interface ElectionProfileData {
  year: number;
  round: number;
  electionDate: string;
  description: string | null;
  states: StateItem[];
  primaryState: StateItem | null;
  overview: CoverageElection[];
  rankings: FeaturedRankings;
}

export interface ProfileLoad<T> {
  status: number;
  data: T | null;
}

const enc = encodeURIComponent;

function normalizedUf(raw: string): string {
  return raw.trim().toUpperCase();
}

function electionCatalog(data: ElectionsResponse) {
  return [...data.elections].sort((a, b) => b.year - a.year || b.round - a.round);
}

function overviewFor(
  overview: OverviewResponse | null,
  year: number,
  round: number,
  uf: string,
): CoverageElection | null {
  return overview?.elections.find((item) => item.year === year && item.round === round && item.uf === uf) ?? null;
}

async function featuredRankings(
  year: number,
  round: number,
  uf: string,
  municipality: string | null,
  offices: readonly OfficeRef[],
  available: boolean,
): Promise<FeaturedRankings> {
  const office = chooseFeaturedOffice(year, offices);
  if (!office || !available) return { office, candidateKind: null, candidates: null, parties: null };
  const candidateKind: "votes" | "share" = !municipality && isMunicipalOffice(office.code) ? "share" : "votes";
  const common = new URLSearchParams({
    year: String(year),
    round: String(round),
    office: String(office.code),
    uf,
    page: "1",
    pageSize: "5",
  });
  if (municipality) common.set("municipality", municipality);
  const candidateParams = new URLSearchParams(common);
  candidateParams.set("kind", candidateKind);
  const partyParams = new URLSearchParams(common);
  partyParams.set("kind", "parties");
  const [candidates, parties] = await Promise.all([
    serverJson<RankingResponse>(`/api/v1/rankings?${candidateParams}`, 900),
    serverJson<RankingResponse>(`/api/v1/rankings?${partyParams}`, 900),
  ]);
  return { office, candidateKind, candidates, parties };
}

async function indicatorCoverage(uf: string): Promise<IndicatorCoverage[]> {
  const catalog = await serverJson<Indicator[]>("/api/v1/data/indicators", 3600);
  if (!catalog) return [];
  const preferred = PREFERRED_INDICATOR_CODES.map((code) => catalog.find((item) => item.code === code)).filter(
    (item): item is Indicator => Boolean(item),
  );
  const rows = await Promise.all(
    preferred.map(async (indicator) => ({
      indicator,
      values: await serverJson<IndicatorValue[]>(`/api/v1/data/values?indicator=${enc(indicator.code)}&uf=${enc(uf)}`, 3600),
    })),
  );
  return rows.flatMap(({ indicator, values }) => {
    if (!values?.length) return [];
    const period = Math.max(...values.map((item) => item.period));
    return [{ indicator, period, observed: values.filter((item) => item.period === period).length }];
  });
}

async function municipalityIndicators(uf: string, ibgeCode: number | null): Promise<ProfileIndicator[]> {
  if (ibgeCode === null) return [];
  const catalog = await serverJson<Indicator[]>("/api/v1/data/indicators", 3600);
  if (!catalog) return [];
  const preferred = PREFERRED_INDICATOR_CODES.map((code) => catalog.find((item) => item.code === code)).filter(
    (item): item is Indicator => Boolean(item),
  );
  const ibge = String(ibgeCode);
  const rows = await Promise.all(
    preferred.map(async (indicator) => ({
      indicator,
      values: await serverJson<IndicatorValue[]>(`/api/v1/data/values?indicator=${enc(indicator.code)}&uf=${enc(uf)}`, 3600),
    })),
  );
  return rows.flatMap(({ indicator, values }) => {
    const value = values
      ?.filter((item) => item.municipalityIbgeCode === ibge)
      .sort((a, b) => b.period - a.period)[0];
    return value ? [{ indicator, value }] : [];
  });
}

export const loadStateProfile = cache(async (rawUf: string): Promise<ProfileLoad<StateProfileData>> => {
  const uf = normalizedUf(rawUf);
  if (!/^[A-Z]{2}$/.test(uf)) return { status: 404, data: null };
  const catalogResult = await serverFetch<ElectionsResponse>("/api/v1/elections", 900);
  if (!catalogResult.data) return { status: catalogResult.status || 503, data: null };
  const overview = await serverJson<OverviewResponse>("/api/v1/overview", 900);
  const reads = await Promise.all(
    electionCatalog(catalogResult.data).map(async (election) => ({
      election,
      result: await serverFetch<StatesResponse>(`/api/v1/elections/${election.year}/${election.round}/states`, 900),
    })),
  );
  let transient = false;
  const snapshots: StateElectionSnapshot[] = [];
  for (const { election, result } of reads) {
    if (!result.data) {
      if (result.status === 0 || result.status >= 500) transient = true;
      continue;
    }
    const state = result.data.states.find((item) => item.uf === uf);
    if (!state) continue;
    snapshots.push({
      year: election.year,
      round: election.round,
      electionDate: election.electionDate,
      description: election.description,
      default: election.default,
      state,
    });
  }
  const ordered = sortElectionSnapshots(snapshots);
  if (!ordered.length) return { status: transient ? 503 : 404, data: null };
  const latest = ordered.find((item) => item.state.resultsAvailable) ?? ordered[0];
  const latestOverview = overviewFor(overview, latest.year, latest.round, uf);
  const [municipalities, indicators, rankings] = await Promise.all([
    serverJson<MunicipalitiesResponse>(
      `/api/v1/elections/${latest.year}/${latest.round}/states/${enc(uf)}/municipalities`,
      900,
    ),
    indicatorCoverage(uf),
    featuredRankings(
      latest.year,
      latest.round,
      uf,
      null,
      latestOverview?.offices ?? [],
      latest.state.resultsAvailable,
    ),
  ]);
  return {
    status: 200,
    data: {
      uf,
      name: latest.state.name,
      ibgeCode: latest.state.ibgeCode,
      snapshots: ordered,
      latest,
      municipalities,
      indicators,
      rankings,
      overview: latestOverview,
    },
  };
});

export const loadMunicipalityProfile = cache(
  async (rawUf: string, rawKey: string): Promise<ProfileLoad<MunicipalityProfileData>> => {
    const uf = normalizedUf(rawUf);
    const key = decodeURIComponent(rawKey).trim();
    if (!/^[A-Z]{2}$/.test(uf) || !key || key.length > 120) return { status: 404, data: null };
    const catalogResult = await serverFetch<ElectionsResponse>("/api/v1/elections", 900);
    if (!catalogResult.data) return { status: catalogResult.status || 503, data: null };
    const elections = electionCatalog(catalogResult.data);
    let seed: MunicipalityDetailResponse | null = null;
    let transient = false;
    for (const election of elections) {
      const result = await serverFetch<MunicipalityDetailResponse>(
        `/api/v1/elections/${election.year}/${election.round}/states/${enc(uf)}/municipalities/${enc(key)}`,
        900,
      );
      if (result.data) {
        seed = result.data;
        break;
      }
      if (result.status === 0 || result.status >= 500) transient = true;
    }
    if (!seed) return { status: transient ? 503 : 404, data: null };
    const stableKey = seed.municipality.ibgeCode === null ? seed.municipality.tseCode : String(seed.municipality.ibgeCode);
    const reads = await Promise.all(
      elections.map(async (election) => ({
        election,
        result: await serverFetch<MunicipalityDetailResponse>(
          `/api/v1/elections/${election.year}/${election.round}/states/${enc(uf)}/municipalities/${enc(stableKey)}`,
          900,
        ),
      })),
    );
    const snapshots: MunicipalityElectionSnapshot[] = [];
    let unavailableElections = 0;
    for (const { election, result } of reads) {
      if (!result.data) {
        if (result.status === 0 || result.status >= 500) unavailableElections++;
        continue;
      }
      snapshots.push({
        year: election.year,
        round: election.round,
        electionDate: election.electionDate,
        description: election.description,
        default: election.default,
        detail: result.data,
      });
    }
    const ordered = sortElectionSnapshots(snapshots);
    if (!ordered.length) return { status: unavailableElections ? 503 : 404, data: null };
    const latest = ordered.find((item) => item.detail.municipality.resultsAvailable) ?? ordered[0];
    const municipality = latest.detail.municipality;
    const overview = await serverJson<OverviewResponse>("/api/v1/overview", 900);
    const latestOverview = overviewFor(overview, latest.year, latest.round, uf);
    const [indicators, rankings] = await Promise.all([
      municipalityIndicators(uf, municipality.ibgeCode),
      featuredRankings(
        latest.year,
        latest.round,
        uf,
        municipality.tseCode,
        latestOverview?.offices ?? [],
        municipality.resultsAvailable,
      ),
    ]);
    return {
      status: 200,
      data: {
        uf,
        name: municipality.name,
        slug: municipality.slug,
        tseCode: municipality.tseCode,
        ibgeCode: municipality.ibgeCode,
        snapshots: ordered,
        latest,
        indicators,
        rankings,
        overview: latestOverview,
        unavailableElections,
      },
    };
  },
);

export const loadElectionProfile = cache(async (year: number, round: number): Promise<ProfileLoad<ElectionProfileData>> => {
  if (!Number.isInteger(year) || !Number.isInteger(round) || year < 1900 || year > 2200 || round < 1 || round > 3)
    return { status: 404, data: null };
  const catalogResult = await serverFetch<ElectionsResponse>("/api/v1/elections", 900);
  if (!catalogResult.data) return { status: catalogResult.status || 503, data: null };
  const election = catalogResult.data.elections.find((item) => item.year === year && item.round === round);
  if (!election) return { status: 404, data: null };
  const [statesResult, overview] = await Promise.all([
    serverFetch<StatesResponse>(`/api/v1/elections/${year}/${round}/states`, 900),
    serverJson<OverviewResponse>("/api/v1/overview", 900),
  ]);
  if (!statesResult.data) return { status: statesResult.status || 503, data: null };
  const stateRows = statesResult.data.states;
  const overviewRows = (overview?.elections ?? []).filter((item) => item.year === year && item.round === round);
  const primaryState =
    stateRows.find((item) => item.resultsAvailable && overviewRows.some((coverage) => coverage.uf === item.uf)) ??
    stateRows.find((item) => item.resultsAvailable) ??
    stateRows.find((item) => item.cadasterAvailable) ??
    null;
  const primaryOverview = primaryState ? overviewFor(overview, year, round, primaryState.uf) : null;
  const rankings = primaryState
    ? await featuredRankings(
        year,
        round,
        primaryState.uf,
        null,
        primaryOverview?.offices ?? [],
        primaryState.resultsAvailable,
      )
    : { office: null, candidateKind: null, candidates: null, parties: null };
  return {
    status: 200,
    data: {
      year,
      round,
      electionDate: election.electionDate,
      description: election.description,
      states: stateRows,
      primaryState,
      overview: overviewRows,
      rankings,
    },
  };
});
