import { fetchJson } from "@/lib/api";
import type { Freshness } from "@/lib/elections/xray-types";

/** Rankings determinísticos (GET /api/v1/rankings). Espelha RankingResponse do backend. */

export type RankingKindKey =
  | "votes"
  | "share"
  | "growth"
  | "decline"
  | "capillarity"
  | "concentration"
  | "territorial_strength"
  | "assets"
  | "asset_growth"
  | "revenue"
  | "spending"
  | "votes_per_real"
  | "parties"
  | "recurrence";

export interface RankingKind {
  key: RankingKindKey;
  label: string;
  unit: string;
  definition: string;
  requires: string[];
  comparability: string;
  source: string;
}

export interface RankingItem {
  position: number;
  entityKind: "candidacy" | "party" | "person";
  candidacyId: string | null;
  politicianId: string | null;
  slug: string | null;
  name: string;
  party: string | null;
  unit: string | null;
  elected: boolean | null;
  value: number;
  valueText: string;
  details: Record<string, string | number | boolean | null>;
}

export interface RankingCoverage {
  zonesCovered: number;
  zonesExpected: number;
  complete: boolean;
  note: string;
}

export interface RankingResponse {
  kind: RankingKind;
  filters: { year: number | null; round: number | null; office: number | null; uf: string; municipality: string | null; party: string | null };
  items: RankingItem[];
  total: number;
  excluded: number;
  excludedNote: string;
  page: number;
  pageSize: number;
  coverage: RankingCoverage | null;
  methodology: string;
  freshness: Freshness | null;
}

// ── Endereço (a URL é a fonte da verdade) ────────────────────────────────────

/** Tipos na URL em português, legíveis e estáveis. */
export const KIND_SLUG: Record<RankingKindKey, string> = {
  votes: "mais-votados",
  share: "participacao",
  growth: "crescimento",
  decline: "queda",
  capillarity: "capilaridade",
  concentration: "concentracao",
  territorial_strength: "forca-territorial",
  assets: "patrimonio",
  asset_growth: "crescimento-patrimonial",
  revenue: "arrecadacao",
  spending: "gastos",
  votes_per_real: "votos-por-real",
  parties: "partidos",
  recurrence: "recorrencia",
};

const KIND_BY_SLUG = Object.fromEntries(Object.entries(KIND_SLUG).map(([k, v]) => [v, k as RankingKindKey])) as Record<string, RankingKindKey>;

/** Grupos do seletor de tipo. */
export const KIND_GROUPS: ReadonlyArray<{ label: string; kinds: RankingKindKey[] }> = [
  { label: "Votação", kinds: ["votes", "share", "growth", "decline"] },
  { label: "Território", kinds: ["capillarity", "concentration", "territorial_strength"] },
  { label: "Patrimônio e contas", kinds: ["assets", "asset_growth", "revenue", "spending", "votes_per_real"] },
  { label: "Partidos e trajetória", kinds: ["parties", "recurrence"] },
];

export interface RankingQuery {
  kind: RankingKindKey;
  year: number | null;
  round: number | null;
  office: number | null;
  uf: string;
  municipality: string | null;
  party: string | null;
  page: number;
}

export const DEFAULT_UF = "CE";

const int = (raw: string | null) => {
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  return Number(raw);
};

export function parseRankingQuery(params: URLSearchParams): RankingQuery {
  const uf = (params.get("uf") ?? DEFAULT_UF).trim().toUpperCase();
  const municipality = params.get("municipio");
  const party = params.get("partido")?.trim().toUpperCase() || null;
  return {
    kind: KIND_BY_SLUG[params.get("tipo") ?? ""] ?? "votes",
    year: int(params.get("ano")),
    round: int(params.get("turno")),
    office: int(params.get("cargo")),
    uf: /^[A-Z]{2}$/.test(uf) ? uf : DEFAULT_UF,
    municipality: municipality && /^\d{1,5}$/.test(municipality) ? municipality.padStart(5, "0") : null,
    party: party && /^[A-Z0-9 ]{1,20}$/.test(party) ? party : null,
    page: Math.max(1, int(params.get("pagina")) ?? 1),
  };
}

export function rankingSearch(q: RankingQuery): string {
  const p = new URLSearchParams();
  p.set("tipo", KIND_SLUG[q.kind]);
  if (q.year !== null) p.set("ano", String(q.year));
  if (q.round !== null) p.set("turno", String(q.round));
  if (q.office !== null) p.set("cargo", String(q.office));
  p.set("uf", q.uf);
  if (q.municipality) p.set("municipio", q.municipality);
  if (q.party) p.set("partido", q.party);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p.toString();
}

// ── Cargos ───────────────────────────────────────────────────────────────────

export interface OfficeOption {
  code: number;
  label: string;
  municipal: boolean;
}

/** Cargos titulares (vice e suplentes são votados na chapa e nunca entram em ranking próprio). */
const GENERAL_OFFICES: OfficeOption[] = [
  { code: 1, label: "Presidente", municipal: false },
  { code: 3, label: "Governador", municipal: false },
  { code: 5, label: "Senador", municipal: false },
  { code: 6, label: "Deputado Federal", municipal: false },
  { code: 7, label: "Deputado Estadual", municipal: false },
  { code: 8, label: "Deputado Distrital", municipal: false },
];

const MUNICIPAL_OFFICES: OfficeOption[] = [
  { code: 11, label: "Prefeito", municipal: true },
  { code: 13, label: "Vereador", municipal: true },
];

/** Eleições gerais nos anos pares não múltiplos de 4; municipais nos múltiplos de 4. Distrital só no DF. */
export function officesFor(year: number | null, uf: string): OfficeOption[] {
  if (year === null) return [];
  if (year % 4 === 0) return uf === "DF" ? [] : MUNICIPAL_OFFICES;
  return GENERAL_OFFICES.filter((o) => (o.code === 8 ? uf === "DF" : o.code !== 7 || uf !== "DF"));
}

export const isMunicipalOffice = (office: number | null) => office === 11 || office === 12 || office === 13;

/**
 * O que falta para o recorte ser comparável — a mesma regra do backend, dita antes de consultar.
 * null = recorte pronto; texto = o que escolher.
 */
export function missingSelection(q: RankingQuery, kind: RankingKind | undefined): string | null {
  if (q.kind === "recurrence") return null;
  if (q.year === null || q.round === null) return "Escolha a eleição.";
  if ((kind?.requires ?? []).includes("office") && q.office === null) return "Escolha o cargo: cada ranking compara uma disputa por vez.";
  if (isMunicipalOffice(q.office) && !q.municipality && (q.kind === "votes" || q.kind === "votes_per_real"))
    return "Prefeito e vereador são disputas diferentes em cada município: escolha o município (ou use “Maior participação”).";
  if (isMunicipalOffice(q.office) && (q.kind === "capillarity" || q.kind === "concentration" || q.kind === "territorial_strength"))
    return "Capilaridade, concentração e força territorial medem a distribuição entre municípios: escolha um cargo estadual ou federal.";
  return null;
}

// ── API ──────────────────────────────────────────────────────────────────────

export const RANKING_PAGE_SIZE = 50;

export const rankingsApi = {
  kinds: () => fetchJson<RankingKind[]>("/api/v1/rankings/kinds"),
  rank: (q: RankingQuery) => {
    const p = new URLSearchParams({ kind: q.kind, uf: q.uf, page: String(q.page), pageSize: String(RANKING_PAGE_SIZE) });
    if (q.year !== null) p.set("year", String(q.year));
    if (q.round !== null) p.set("round", String(q.round));
    if (q.office !== null) p.set("office", String(q.office));
    if (q.municipality) p.set("municipality", q.municipality);
    if (q.party) p.set("party", q.party);
    return fetchJson<RankingResponse>(`/api/v1/rankings?${p}`);
  },
};
