/**
 * Busca global (GET /api/v1/search): políticos, lugares, partidos e pleitos numa consulta só.
 * O backend normaliza a consulta, extrai ano/turno/cargo e ordena os grupos pela melhor
 * correspondência; aqui só montamos destinos (rotas que já existem) e rótulos.
 */
import { fetchJson } from "./api";
import { buildElectionsPath } from "./elections/route";
import { politicianPath } from "./paths";

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;

export interface SearchElectionKey {
  year: number;
  round: number;
}

export interface SearchCandidacy {
  year: number;
  round: number;
  officeCode: number | null;
  officeName: string | null;
  unitName: string | null;
  uf: string | null;
  party: string | null;
  elected: boolean | null;
}

export interface SearchPolitician {
  id: string;
  name: string;
  ballotName: string | null;
  slug: string | null;
  rank: number;
  candidacy: SearchCandidacy | null;
}

export interface SearchTerritory {
  kind: "state" | "municipality";
  uf: string;
  tseCode: string | null;
  name: string;
  slug: string | null;
  stateName: string | null;
  rank: number;
  elections: SearchElectionKey[];
}

export interface SearchParty {
  acronym: string;
  name: string | null;
  number: number | null;
  candidacies: number;
  year: number;
  round: number;
  rank: number;
}

export interface SearchElection {
  year: number;
  round: number;
  uf: string;
  municipality: string | null;
  placeName: string;
  officeCode: number | null;
  officeName: string | null;
  rank: number;
  label: string;
}

export type SearchGroupKey = "politicians" | "territories" | "elections" | "parties";

export interface SearchResponse {
  query: string;
  filter: { year: number | null; round: number | null; officeCode: number | null; officeName: string | null };
  order: SearchGroupKey[];
  politicians: SearchPolitician[];
  territories: SearchTerritory[];
  parties: SearchParty[];
  elections: SearchElection[];
}

/** Consulta pronta para ir ao servidor (aparada, limitada); `null` = curta demais para buscar. */
export function searchableQuery(raw: string): string | null {
  const q = raw.trim().slice(0, SEARCH_MAX_LENGTH);
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

export function searchAll(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: "6" });
  return fetchJson<SearchResponse>(`/api/v1/search?${params}`, { signal });
}

export function politicianHref(p: SearchPolitician): string {
  return politicianPath(p);
}

/** Lugar com pleito importado → explorador no pleito mais recente; sem dados → `null` (não há para onde ir). */
export function territoryHref(t: SearchTerritory): string | null {
  const latest = t.elections[0];
  if (!latest) return null;
  return buildElectionsPath({
    year: latest.year,
    round: latest.round,
    state: t.uf.toLowerCase(),
    municipality: t.kind === "municipality" ? t.slug ?? undefined : undefined,
  });
}

export function electionHref(e: SearchElection): string {
  const path = buildElectionsPath({
    year: e.year,
    round: e.round,
    state: e.uf.toLowerCase(),
    municipality: e.municipality ?? undefined,
  });
  return e.officeCode ? `${path}?cargo=${e.officeCode}` : path;
}

export function partyHref(p: SearchParty): string {
  return `/politicos?${new URLSearchParams({ party: p.acronym })}`;
}

export const GROUP_LABEL: Record<SearchGroupKey, string> = {
  politicians: "Políticos e candidatos",
  territories: "Lugares",
  elections: "Eleições",
  parties: "Partidos",
};

/** Uma opção navegável do combobox (lugares sem dados não viram opção: não levariam a lugar nenhum). */
export interface SearchOption {
  id: string;
  group: SearchGroupKey;
  href: string;
  item: SearchPolitician | SearchTerritory | SearchParty | SearchElection;
}

export function searchOptions(r: SearchResponse | undefined): SearchOption[] {
  if (!r) return [];
  const options: SearchOption[] = [];
  for (const group of r.order) {
    if (group === "politicians")
      r.politicians.forEach((p) => options.push({ id: `p-${p.id}`, group, href: politicianHref(p), item: p }));
    if (group === "territories")
      r.territories.forEach((t) => {
        const href = territoryHref(t);
        if (href) options.push({ id: `t-${t.uf}-${t.tseCode ?? "uf"}`, group, href, item: t });
      });
    if (group === "elections")
      r.elections.forEach((e) =>
        options.push({ id: `e-${e.year}-${e.round}-${e.uf}-${e.municipality ?? ""}-${e.officeCode ?? ""}`, group, href: electionHref(e), item: e }),
      );
    if (group === "parties")
      r.parties.forEach((p) => options.push({ id: `pa-${p.acronym}`, group, href: partyHref(p), item: p }));
  }
  return options;
}

/** Lugares encontrados que ainda não têm eleição importada (mostrados como aviso, não como link). */
export function placesWithoutData(r: SearchResponse | undefined): SearchTerritory[] {
  return r ? r.territories.filter((t) => t.elections.length === 0) : [];
}

/** Anos distintos, do mais recente: "2026, 2024 e 2022". */
export function electionYears(elections: SearchElectionKey[]): string {
  const years = [...new Set(elections.map((e) => e.year))];
  if (years.length <= 1) return years.join("");
  return `${years.slice(0, -1).join(", ")} e ${years.at(-1)}`;
}

/** Exemplos neutros (lugares e cargos): a página inicial não destaca pessoa nem partido. */
export const SEARCH_EXAMPLES = ["Fortaleza", "Juazeiro do Norte", "Deputado Federal 2022", "Prefeito 2024 2º turno"] as const;
