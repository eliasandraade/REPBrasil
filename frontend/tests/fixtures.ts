/**
 * Respostas no formato da API eleitoral (/api/v1/elections). Territórios e
 * números de zona reais (CE 2026); contagens e votos REDUZIDOS e sintéticos —
 * servem para testar comportamento, não para conferir resultado oficial.
 */
import type {
  MunicipalitiesResponse,
  MunicipalityDetailResponse,
  SectionResultsResponse,
  StatesResponse,
  ZoneDetailResponse,
  ZoneItem,
} from "@/lib/elections/types";

export const ELECTION = { year: 2026, round: 1, electionDate: "2026-10-04", description: "1º Turno" };

const ce = {
  uf: "CE", slug: "ce", name: "Ceará", ibgeCode: 23, territoryKnown: true, municipalities: 184,
  cadasterAvailable: true, cadasterMunicipalities: 184, resultsAvailable: true, resultsMunicipalities: 184,
};
const sp = {
  uf: "SP", slug: "sp", name: "São Paulo", ibgeCode: 35, territoryKnown: true, municipalities: 645,
  cadasterAvailable: false, cadasterMunicipalities: 0, resultsAvailable: false, resultsMunicipalities: 0,
};

export const STATES: StatesResponse = { election: ELECTION, states: [ce, sp] };

const mun = (name: string, slug: string, tseCode: string, ibgeCode: number, zones: number) => ({
  tseCode, ibgeCode, name, slug, uf: "CE", territoryKnown: true, cadasterAvailable: true, resultsAvailable: true, zones,
});

export const GS = mun("General Sampaio", "general-sampaio", "13935", 2304608, 1);
export const CAUCAIA = mun("Caucaia", "caucaia", "13730", 2303709, 3);
export const FORTALEZA = mun("Fortaleza", "fortaleza", "13897", 2304400, 17);

export const MUNICIPALITIES: MunicipalitiesResponse = {
  election: ELECTION, state: ce, status: "available", municipalities: [CAUCAIA, FORTALEZA, GS],
};

const zone = (number: number, resultsAvailable = true): ZoneItem => ({
  number, sections: 4, principalSections: 3, aggregatedSections: 1, pollingPlaces: 2, pollingPlacesWithCoordinates: 1,
  eligible: { federal: 900, state: 899 }, resultsAvailable,
});

const detail = (m: ReturnType<typeof mun>, zones: number[]): MunicipalityDetailResponse => ({
  election: ELECTION, state: ce, municipality: m, status: "available", zones: zones.map((z) => zone(z)),
  summary: { zones: zones.length, sections: zones.length * 4, principalSections: zones.length * 3, aggregatedSections: zones.length,
    pollingPlaces: zones.length * 2, pollingPlacesWithCoordinates: zones.length, eligible: { federal: 900 * zones.length, state: null } },
  provenance: null,
});

export const MUNICIPALITY_DETAIL: Record<string, MunicipalityDetailResponse> = {
  "general-sampaio": detail(GS, [50]),
  caucaia: detail(CAUCAIA, [37, 120, 123]),
  fortaleza: detail(FORTALEZA, [1, 2, 3, 80, 82, 83, 85, 93, 94, 95, 112, 113, 114, 115, 116, 117, 118]),
};

export function zoneDetail(slug: string, number: number): ZoneDetailResponse {
  const d = MUNICIPALITY_DETAIL[slug];
  return {
    election: ELECTION, state: ce, municipality: d.municipality, status: "available", zone: zone(number),
    places: [
      {
        code: "1015", name: "ESCOLA FICTÍCIA A", address: "RUA A, 1", neighborhood: "CENTRO", postalCode: null, placeType: null,
        coordinates: { latitude: -3.7, longitude: -38.5, source: "tse" },
        sections: [
          { number: 58, principalNumber: 58, isAggregated: false, placeCode: "1015", aggregatedSections: [79], eligible: { federal: 319, state: 319 } },
          { number: 79, principalNumber: 58, isAggregated: true, placeCode: "1015", aggregatedSections: [], eligible: null },
        ],
      },
      {
        code: "1023", name: "ESCOLA FICTÍCIA B", address: null, neighborhood: "BAIRRO B", postalCode: null, placeType: null,
        coordinates: null,
        sections: [
          { number: 381, principalNumber: 381, isAggregated: false, placeCode: "1023", aggregatedSections: [], eligible: { federal: 336, state: 336 } },
          { number: 29, principalNumber: 29, isAggregated: false, placeCode: "1023", aggregatedSections: [], eligible: { federal: null, state: null } },
        ],
      },
    ],
    provenance: null,
  };
}

export function sectionResults(section: number, over: Partial<SectionResultsResponse> = {}): SectionResultsResponse {
  return {
    election: ELECTION,
    territory: { uf: "CE", municipality: { tseCode: "13897", ibgeCode: 2304400, name: "Fortaleza", slug: "fortaleza" }, zone: 94 },
    requestedSection: section,
    status: "available",
    principalSection: section,
    aggregated: false,
    aggregatedSections: [],
    availableOffices: [
      { code: 1, name: "Presidente", electionCode: 6257 },
      { code: 3, name: "Governador", electionCode: 6259 },
    ],
    selectedOffice: { code: 1, name: "Presidente", electionCode: 6257, electionDescription: "Eleição Geral Federal 2026" },
    metrics: { eligible: 336, turnout: 301, abstentions: 35, valid: 283, blank: 5, null: null },
    percentageBasis: { denominator: "valid_votes", definition: "nominais + legenda", appliesTo: ["nominal", "legenda"] },
    votes: [
      {
        voteType: "nominal", voteTypeSource: { code: 1, description: "Nominal" }, votable: { number: 11, name: "CANDIDATA COM PERFIL" },
        party: { number: 11, acronym: "PA", name: "PARTIDO A" }, votes: 153, percentage: 54.06,
        candidacy: { candidacyId: "c-1", tseCandidateId: 280001, personId: "p-1", politicianId: "pol-1" }, profileAvailable: true,
      },
      {
        voteType: "nominal", voteTypeSource: { code: 1, description: "Nominal" }, votable: { number: 22, name: "CANDIDATO SEM PERFIL" },
        party: { number: 22, acronym: "PB", name: "PARTIDO B" }, votes: 130, percentage: 45.94, candidacy: null, profileAvailable: false,
      },
      {
        voteType: "branco", voteTypeSource: { code: 2, description: "Branco" }, votable: { number: 95, name: "Branco" },
        party: null, votes: 5, percentage: null, candidacy: null, profileAvailable: false,
      },
    ],
    urn: { number: 2000001, type: "Apurada", emittedAt: null, receivedAt: null, pollingPlaceCode: 1023 },
    provenance: {
      source: "Tribunal Superior Eleitoral · Dados Abertos", dataset: "resultados-2026-boletim-de-urna", resourceId: "r",
      resourceName: "CE - Boletim de Urna - Primeiro turno - 05.10.2026", url: "https://cdn.tse.jus.br/x.zip",
      sourceFileSha256: "db72adfff90313635ee992714b34045f56a65ee2a2c7fd2462b3714ce169e62e", csvSha256: "e6",
      officialChecksum: { algorithm: "sha512", verified: true }, sourceGeneratedAt: "05/10/2026 14:03:00",
      importedAt: "2026-10-09T22:00:00Z", importBatchId: "batch-1", validation: { reconciliation: "passed", ea20: "not_available" },
      warnings: [],
    },
    ...over,
  };
}
