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
