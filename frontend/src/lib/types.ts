export interface PoliticianSummary {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  partyAcronym: string | null;
  office: string | null;
  state: string | null;
}

export interface PoliticianDetail {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  camaraId: string | null;
  senateId: string | null;
  state: string | null;
  partyAcronym: string | null;
  partyName: string | null;
  office: string | null;
  candidacyStatus: string | null;
  createdAt: string;
  sourceUpdatedAt: string | null;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface SearchFilters {
  state?: string;
  party?: string;
  office?: string;
}

export interface ElectionResultItem {
  year: number;
  round: number;
  office: string;
  state: string;
  city: string | null;
  totalVotes: number;
  situation: string | null;
  elected: boolean;
}

export interface AssetItemDetail {
  order: number;
  typeCode: string | null;
  typeDescription: string | null;
  description: string | null;
  value: number;
}

export interface AssetDeclarationItem {
  year: number;
  totalValue: number;
  items: AssetItemDetail[];
}

export interface DataSourceItem {
  name: string;
  organization: string;
  sourceType: string;
  originalUrl: string;
  collectedAt: string;
  hash: string | null;
  fileSizeBytes: number | null;
  license: string | null;
}

export interface ScoreFactorItem {
  factorKey: string;
  factorCategory: string;
  factorLabel: string;
  factorValue: number | null;
  factorWeight: number | null;
  evidenceId: string | null;
  sourceId: string | null;
  evidenceReference: string | null;
  sourceReference: string | null;
  explanation: string | null;
}

export interface ScoreStatusItem {
  status: string;
  methodologyVersion: string;
  generatedAt: string | null;
  totalScore: number | null;
  factors: ScoreFactorItem[];
  disclaimer: string;
}

export interface Mandate {
  id: string;
  house: string;
  legislature: number;
  title: string | null;
  state: string | null;
  partyAcronym: string | null;
  startDate: string | null;
  endDate: string | null;
  externalId: string | null;
  externalUrl: string | null;
}
