export interface PoliticianSummary {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
}

export interface PoliticianDetail {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  camaraId: string | null;
  senateId: string | null;
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
