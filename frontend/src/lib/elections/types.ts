// Contratos da API eleitoral (/api/v1/elections, /api/v1/politicians/{id}/candidacies).
// Três camadas de disponibilidade, nunca confundidas: território conhecido,
// cadastro eleitoral importado e resultados importados. `null` = não informado
// pela fonte — nunca zero.

export interface ElectionRef {
  year: number;
  round: number;
  electionDate: string;
  description: string | null;
}

export interface ElectionItem extends ElectionRef {
  cadasterAvailable: boolean;
  resultsAvailable: boolean;
  default: boolean;
}

export interface ElectionsResponse {
  elections: ElectionItem[];
}

export interface StateItem {
  uf: string;
  slug: string;
  name: string;
  ibgeCode: number | null;
  territoryKnown: boolean;
  municipalities: number;
  cadasterAvailable: boolean;
  cadasterMunicipalities: number;
  resultsAvailable: boolean;
  resultsMunicipalities: number;
}

export interface StatesResponse {
  election: ElectionRef;
  states: StateItem[];
}

export interface MunicipalityItem {
  tseCode: string;
  ibgeCode: number | null;
  name: string;
  slug: string;
  uf: string;
  territoryKnown: boolean;
  cadasterAvailable: boolean;
  resultsAvailable: boolean;
  zones: number;
}

export type CatalogStatus = "available" | "cadaster_missing";

export interface MunicipalitiesResponse {
  election: ElectionRef;
  state: StateItem;
  status: CatalogStatus;
  municipalities: MunicipalityItem[];
}

export interface Eligible {
  federal: number | null;
  state: number | null;
}

export interface ZoneItem {
  number: number;
  sections: number;
  principalSections: number;
  aggregatedSections: number;
  pollingPlaces: number;
  pollingPlacesWithCoordinates: number;
  eligible: Eligible;
  resultsAvailable: boolean;
}

export interface CadasterProvenance {
  source: string;
  dataset: string;
  resourceId: string | null;
  resourceName: string;
  url: string;
  sourceFileSha256: string;
  checksum: string | null;
  csvName: string | null;
  csvSha256: string | null;
  sourceGeneratedAt: string | null;
  importedAt: string;
  importBatchId: string;
}

export interface MunicipalityDetailResponse {
  election: ElectionRef;
  state: StateItem;
  municipality: MunicipalityItem;
  status: CatalogStatus;
  zones: ZoneItem[];
  summary: {
    zones: number;
    sections: number;
    principalSections: number;
    aggregatedSections: number;
    pollingPlaces: number;
    pollingPlacesWithCoordinates: number;
    eligible: Eligible;
  } | null;
  provenance: CadasterProvenance | null;
}

export interface SectionItem {
  number: number;
  principalNumber: number;
  isAggregated: boolean;
  placeCode: string;
  aggregatedSections: number[];
  /** Aptos da URNA (principal); `null` em agregadas — contados na principal. */
  eligible: Eligible | null;
}

export interface PlaceItem {
  code: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  placeType: string | null;
  /** Só coordenadas publicadas pela fonte oficial. */
  coordinates: { latitude: number; longitude: number; source: string | null } | null;
  sections: SectionItem[];
}

export interface ZoneDetailResponse {
  election: ElectionRef;
  state: StateItem;
  municipality: MunicipalityItem;
  status: CatalogStatus;
  zone: ZoneItem | null;
  places: PlaceItem[];
  provenance: CadasterProvenance | null;
}

export type SectionResultsStatus = "available" | "not_ingested" | "cadaster_missing";

export interface Metrics {
  eligible: number | null;
  turnout: number | null;
  abstentions: number | null;
  valid: number | null;
  blank: number | null;
  null: number | null;
}

export interface CandidacyLink {
  candidacyId: string;
  tseCandidateId: number;
  personId: string | null;
  politicianId: string | null;
}

export interface VoteItem {
  voteType: string;
  voteTypeSource: { code: number; description: string };
  votable: { number: number; name: string | null };
  party: { number: number; acronym: string | null; name: string | null } | null;
  votes: number;
  percentage: number | null;
  candidacy: CandidacyLink | null;
  profileAvailable: boolean;
}

export interface ResultProvenance {
  source: string;
  dataset: string;
  resourceId: string | null;
  resourceName: string;
  url: string;
  sourceFileSha256: string;
  csvSha256: string;
  officialChecksum: { algorithm: string; verified: boolean };
  sourceGeneratedAt: string | null;
  importedAt: string;
  importBatchId: string;
  validation: { reconciliation: string; ea20: string };
  warnings: Array<Record<string, unknown>>;
}

export interface SectionResultsResponse {
  election: ElectionRef;
  territory: { uf: string; municipality: { tseCode: string; ibgeCode: number | null; name: string; slug: string }; zone: number };
  requestedSection: number;
  status: SectionResultsStatus;
  principalSection: number | null;
  aggregated: boolean | null;
  aggregatedSections: number[] | null;
  availableOffices: Array<{ code: number; name: string | null; electionCode: number }> | null;
  selectedOffice: { code: number; name: string | null; electionCode: number; electionDescription: string | null } | null;
  metrics: Metrics | null;
  percentageBasis: { denominator: string; definition: string; appliesTo: string[] } | null;
  votes: VoteItem[] | null;
  urn: { number: number | null; type: string | null; emittedAt: string | null; receivedAt: string | null; pollingPlaceCode: number | null } | null;
  provenance: ResultProvenance | null;
}

export interface TerritoryPerformance {
  uf: string;
  municipalityTseCode: string;
  municipalityName: string | null;
  municipalitySlug: string | null;
  votes: number;
  validVotes: number;
  shareOfValidVotes: number | null;
  urns: number;
}

export interface CandidacyPerformance {
  votes: number;
  coverage: { complete: boolean; ufs: Array<{ uf: string; municipalitiesWithResults: number; municipalitiesInCadaster: number }>; note: string };
  municipalities: TerritoryPerformance[];
  municipalitiesWithVotes: number;
  definitions: Record<string, string>;
}

export interface CandidacyItem {
  id: string;
  tseCandidateId: number;
  contest: {
    year: number;
    round: number;
    tseElectionCode: number;
    tseElectionDescription: string | null;
    officeCode: number;
    officeName: string;
    scope: string;
    electoralUnit: string;
  };
  candidateNumber: number;
  ballotName: string;
  party: { number: number; acronym: string | null; name: string | null } | null;
  federationAcronym: string | null;
  coalitionName: string | null;
  candidacyStatus: string | null;
  roundOutcome: string | null;
  elected: boolean | null;
  identityStatus: string;
  personId: string | null;
  politicianId: string | null;
  profileAvailable: boolean;
  source: { source: string; url: string; zipSha256: string; member: string; line: number };
  performance: CandidacyPerformance | null;
}

export interface PoliticianCandidaciesResponse {
  politicianId: string;
  candidacies: CandidacyItem[];
}
