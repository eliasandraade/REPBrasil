import { fetchJson } from "./api";

export interface ParliamentMember {
  id: number;
  institution: "camara" | "senado" | "alece";
  externalId: string;
  name: string;
  parliamentaryName: string | null;
  stateCode: string | null;
  partyAcronym: string | null;
  photoUrl: string | null;
  identityMethod: "official_document" | "unlinked";
  provider: string;
  dataset: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface ParliamentActivity {
  id: number;
  memberId: number;
  institution: string;
  activityType: string;
  externalId: string;
  occurredAt: string | null;
  title: string | null;
  description: string | null;
  sourceUrl: string | null;
  provider: string;
  dataset: string;
  datasetSourceUrl: string;
  retrievedAt: string;
}

export interface ParliamentAmendment {
  id: number;
  externalId: string;
  authorMemberId: number | null;
  authorName: string | null;
  year: number | null;
  amendmentType: string | null;
  functionalProgramming: string | null;
  beneficiaryDocument: string | null;
  beneficiaryName: string | null;
  locality: string | null;
  municipalityIbgeCode: string | null;
  committedAmount: number | null;
  paidAmount: number | null;
  provider: string;
  dataset: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface AmendmentMunicipality {
  municipalityIbgeCode: string;
  municipalityName: string;
  amendmentCount: number;
  /** Soma só dos valores publicados; null quando nenhuma emenda do município tem valor. */
  committedAmount: number | null;
  /** Emendas sem valor empenhado publicado (soma parcial quando > 0). */
  committedAmountMissing: number;
  paidAmount: number | null;
  paidAmountMissing: number;
  retrievedAt: string;
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("pt-BR");

function amendments(total: number): string {
  return `${integer.format(total)} emenda${total === 1 ? "" : "s"}`;
}

function amountText(value: number | null, missing: number, label: string): string {
  if (value === null) return `${label} não publicado`;
  const total = `${money.format(value)} ${label}`;
  return missing > 0 ? `${total} (soma parcial: ${amendments(missing)} sem valor publicado)` : total;
}

/** Texto do município no mapa: valor ausente nunca vira zero nem é apresentado como total. */
export function describeAmendmentMunicipality(row: AmendmentMunicipality): string {
  return [
    amendments(row.amendmentCount),
    amountText(row.committedAmount, row.committedAmountMissing, "empenhado"),
    amountText(row.paidAmount, row.paidAmountMissing, "pago"),
  ].join(" · ");
}

/** Só um total completo (todas as emendas com valor publicado) entra na escala de cor. */
export function isCompleteCommittedTotal(row: AmendmentMunicipality): boolean {
  return row.committedAmount !== null && row.committedAmountMissing === 0;
}

function query(path: string, params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  return `${path}?${search}`;
}

export function getParliamentMembers(uf = "CE", institution?: string): Promise<ParliamentMember[]> {
  return fetchJson<ParliamentMember[]>(query("/api/v1/parliament/members", { uf, institution }));
}

export function getParliamentActivities(params: { memberId?: number | null; institution?: string; uf?: string; limit?: number } = {}): Promise<ParliamentActivity[]> {
  return fetchJson<ParliamentActivity[]>(query("/api/v1/parliament/activities", {
    memberId: params.memberId,
    institution: params.institution,
    uf: params.uf,
    limit: params.limit ?? 100,
  }));
}

export function getParliamentAmendments(params: { year?: number | null; memberId?: number | null; uf?: string; limit?: number } = {}): Promise<ParliamentAmendment[]> {
  return fetchJson<ParliamentAmendment[]>(query("/api/v1/parliament/amendments", {
    year: params.year,
    memberId: params.memberId,
    uf: params.uf,
    limit: params.limit ?? 100,
  }));
}

export function getAmendmentMap(year?: number | null, uf = "CE"): Promise<AmendmentMunicipality[]> {
  return fetchJson<AmendmentMunicipality[]>(query("/api/v1/parliament/amendments/map", { year, uf }));
}
