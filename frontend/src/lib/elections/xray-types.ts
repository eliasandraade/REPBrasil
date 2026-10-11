// Contratos do Raio X eleitoral (/api/v1/politicians/{id}/xray, /api/v1/elections/...).
// `null` = não informado/não afirmável — nunca zero. O estado (`state`) diz por quê.

export type CellState =
  | "value"
  | "zero"
  | "outside_contest"
  | "no_coverage"
  | "partial_coverage"
  | "not_on_ballot"
  | "unlinked"
  | "ticket_member"
  | "absent";

export type ContestComparability =
  | "comparable_contest"
  | "different_office"
  | "different_territorial_scope"
  | "direct_comparison_unavailable";

export type TerritoryComparability = "comparable" | "section_composition_changed" | "coverage_or_section_missing";

export interface Insight {
  code: string;
  values: Record<string, unknown>;
  text: string;
}

export interface ElectoralUnit {
  scope: "federal" | "state" | "municipal";
  code: string;
  name: string;
  uf: string | null;
}

export interface ContestRef {
  year: number;
  round: number;
  electionCode: number;
  officeCode: number;
  officeName: string;
  unit: ElectoralUnit;
}

export interface Party {
  number: number | null;
  acronym: string | null;
  name: string | null;
}

export interface Freshness {
  stale: boolean;
  refreshedAt: string | null;
  note: string;
}

export interface Coverage {
  complete: boolean;
  zonesImported: number;
  zonesExpected: number;
  note: string;
}

export interface CandidacyTotals {
  votes: number | null;
  validVotes: number | null;
  shareOfValidVotes: number | null;
  rank: number | null;
  candidatesWithVotes: number | null;
  state: CellState;
  coverage: Coverage;
}

export interface Ticket {
  role: "vice" | "first_substitute" | "second_substitute";
  headCandidacyId: string | null;
  headBallotName: string | null;
  headOfficeCode: number | null;
  headVotes: number | null;
  headShare: number | null;
  note: string;
}

export interface CandidacyRecords {
  socialNetworks: string[];
  complement: Record<string, unknown> | null;
}

export interface XrayCandidacy {
  candidacyId: string;
  tseCandidateId: number;
  contest: ContestRef;
  number: number;
  ballotName: string;
  party: Party | null;
  federationAcronym: string | null;
  coalitionName: string | null;
  candidacyStatus: string | null;
  roundOutcome: string | null;
  elected: boolean | null;
  identityStatus: string;
  identityMethod: string | null;
  ticket: Ticket | null;
  totals: CandidacyTotals;
  assets: { items: number; total: number } | null;
  finance: {
    revenues: number | null;
    expensesContracted: number | null;
    expensesPaid: number | null;
    records: number;
    accountsType: string | null;
  } | null;
  records: CandidacyRecords;
  source: { source: string; url: string; zipSha256: string; member: string; line: number };
}

export interface PriorCandidacy {
  year: number;
  round: number;
  tseCandidateId: number;
  officeCode: number | null;
  officeName: string | null;
  unit: string | null;
  unitName: string | null;
  number: number | null;
  ballotName: string | null;
  partyAcronym: string | null;
  outcome: string | null;
  imported: boolean;
  candidacyId: string | null;
}

export interface EvolutionStep {
  fromCandidacyId: string;
  toCandidacyId: string;
  comparability: ContestComparability;
  fromVotes: number | null;
  toVotes: number | null;
  deltaVotes: number | null;
  deltaPercent: number | null;
  fromShare: number | null;
  toShare: number | null;
  deltaSharePoints: number | null;
}

export interface AssetsStep {
  fromCandidacyId: string;
  toCandidacyId: string;
  fromTotal: number;
  toTotal: number;
  delta: number;
  deltaPercent: number | null;
  added: number;
  removed: number;
  kept: number;
}

export interface XrayResponse {
  politicianId: string;
  personId: string | null;
  name: string;
  candidacies: XrayCandidacy[];
  officialHistory: PriorCandidacy[];
  evolution: EvolutionStep[];
  assetsEvolution: AssetsStep[];
  insights: Insight[];
  freshness: Freshness;
  definitions: Record<string, string>;
}

export type TerritoryLevel = "state" | "municipality" | "zone" | "section" | "place";

export interface TerritoryValue {
  uf: string;
  municipalityTseCode: string | null;
  municipalityName: string | null;
  zone: number | null;
  section: number | null;
  sectionMembers: number[] | null;
  placeCode: string | null;
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  votes: number | null;
  validVotes: number | null;
  share: number | null;
  eligible: number | null;
  turnout: number | null;
  urns: number;
  state: CellState;
}

export interface DistributionSummary {
  votes: number | null;
  territoriesWithVotes: number;
  territoriesCovered: number;
  topFiveConcentration: number | null;
  hhi: number | null;
  best: TerritoryValue | null;
  worst: TerritoryValue | null;
  bestShare: TerritoryValue | null;
}

export interface CandidacyTerritoryResponse {
  candidacyId: string;
  contest: ContestRef;
  level: TerritoryLevel;
  municipalityTseCode: string | null;
  zone: number | null;
  territories: TerritoryValue[];
  summary: DistributionSummary;
  insights: Insight[];
  freshness: Freshness;
  definitions: Record<string, string>;
}

export interface AssetItem {
  typeCode: number | null;
  type: string | null;
  description: string | null;
  value: number;
}

export interface AssetDiffItem {
  status: "kept" | "added" | "removed";
  typeCode: number | null;
  type: string | null;
  description: string | null;
  fromValue: number | null;
  toValue: number | null;
}

export interface CandidacyAssetsResponse {
  candidacyId: string;
  year: number;
  items: AssetItem[];
  total: number;
  compareToCandidacyId: string | null;
  compareToYear: number | null;
  compareToTotal: number | null;
  delta: number | null;
  deltaPercent: number | null;
  diff: AssetDiffItem[];
  byType: Array<{ typeCode: number | null; type: string | null; total: number; items: number; compareToTotal: number | null }>;
  note: string;
}

export interface FinanceCounterparty {
  kind: string;
  name: string | null;
  counterpartyKind: "person" | "company" | "unidentified";
  cnpj: string | null;
  amount: number;
  records: number;
}

export interface CandidacyFinanceResponse {
  candidacyId: string;
  revenues: number | null;
  expensesContracted: number | null;
  expensesPaid: number | null;
  categories: Array<{ kind: string; category: string; amount: number; records: number }>;
  topDonors: FinanceCounterparty[];
  topSuppliers: FinanceCounterparty[];
  accountsType: string | null;
  note: string;
}

export interface TerritoryCandidate {
  candidacyId: string;
  politicianId: string | null;
  contest: ContestRef;
  number: number;
  ballotName: string;
  party: Party | null;
  federationAcronym: string | null;
  candidacyStatus: string | null;
  roundOutcome: string | null;
  elected: boolean | null;
  votes: number | null;
  share: number | null;
  rank: number | null;
  state: CellState;
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface TerritoryCandidatesResponse {
  year: number;
  round: number;
  uf: string;
  municipalityTseCode: string | null;
  municipalityName: string | null;
  zone: number | null;
  items: TerritoryCandidate[];
  total: number;
  page: number;
  pageSize: number;
  offices: Facet[];
  parties: Facet[];
  statuses: Facet[];
  freshness: Freshness;
}

export type MapLayerKind = "intensity" | "share" | "winner" | "growth" | "decline" | "ab" | "base";

export interface MapFeature {
  key: string;
  municipalityTseCode: string | null;
  ibgeCode: number | null;
  name: string;
  zone: number | null;
  placeCode: string | null;
  latitude: number | null;
  longitude: number | null;
  value: number | null;
  category: string | null;
  categoryLabel: string | null;
  state: string;
  details: Record<string, unknown>;
}

export interface MapLayerResponse {
  year: number;
  round: number;
  uf: string;
  municipalityTseCode: string | null;
  layer: MapLayerKind;
  level: "municipality" | "place";
  officeCode: number | null;
  features: MapFeature[];
  legend: Array<{ category: string; label: string; rank: number }>;
  min: number | null;
  max: number | null;
  comparability: ContestComparability | null;
  note: string;
  freshness: Freshness;
}

export interface CompareCell {
  candidacyId: string;
  votes: number | null;
  validVotes: number | null;
  share: number | null;
  state: CellState;
}

export interface CompareEvolution {
  subject: number;
  fromCandidacyId: string;
  toCandidacyId: string;
  comparability: ContestComparability | TerritoryComparability;
  deltaVotes: number | null;
  deltaPercent: number | null;
  deltaSharePoints: number | null;
}

export interface CompareTerritory {
  key: string;
  uf: string;
  municipalityTseCode: string | null;
  municipalityName: string | null;
  zone: number | null;
  section: number | null;
  placeCode: string | null;
  placeName: string | null;
  comparability: TerritoryComparability;
  membersByElection: Record<string, number[]> | null;
  cells: CompareCell[];
  evolution: CompareEvolution[];
  leaders: Array<{ election: number; candidacyId: string | null; tie: boolean }>;
}

export interface ComparisonResponse {
  level: TerritoryLevel;
  uf: string;
  municipalityTseCode: string | null;
  zone: number | null;
  subjects: Array<{ index: number; politicianId: string | null; personId: string | null; name: string; candidacyIds: string[] }>;
  elections: Array<{ index: number; year: number; round: number }>;
  candidacies: Array<{
    candidacyId: string;
    subject: number;
    election: number;
    contest: ContestRef;
    number: number;
    ballotName: string;
    party: Party | null;
    candidacyStatus: string | null;
    roundOutcome: string | null;
    elected: boolean | null;
    votes: number | null;
    share: number | null;
    state: CellState;
  }>;
  pairs: Array<{ first: string; second: string; comparability: ContestComparability }>;
  territories: CompareTerritory[];
  overtakes: Array<{ subject: number; overtakenSubject: number; fromElection: number; toElection: number; territories: number; keys: string[] }>;
  extremes: Array<{ subject: number; fromCandidacyId: string; toCandidacyId: string; kind: "growth" | "decline"; key: string; label: string; deltaVotes: number; deltaPercent: number | null }>;
  insights: Insight[];
  freshness: Freshness;
  definitions: Record<string, string>;
}
