import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapLayerResponse } from "@/lib/elections/xray-types";
import type { PartiesResponse, PartyProfileResponse, PartyResult } from "@/lib/parties";

const nav = vi.hoisted(() => ({ pathname: "/partidos", search: "", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { PartiesExplorer, changeText } from "@/components/parties/PartiesExplorer";
import { PartyProfile } from "@/components/parties/PartyProfile";
import { buildLayerView } from "@/lib/elections/map-layers";
import { SEQUENTIAL } from "@/lib/dataviz/palette";

const FRESH = { stale: false, refreshedAt: "2026-10-10T00:00:00Z", note: "Agregados atualizados." };

const result = (over: Partial<PartyResult> = {}): PartyResult => ({
  year: 2022, round: 1, officeCode: 7, officeName: "Deputado Estadual", partyNumber: 65, federations: null,
  votes: 1000, nominalVotes: 900, legendVotes: 100, validVotes: 10_000, share: 10, candidacies: 20, elected: 2,
  municipalitiesWithVotes: 150, municipalitiesCovered: 184, change: null, ...over,
});

const LIST: PartiesResponse = {
  uf: "CE",
  elections: [
    { year: 2024, round: 1, offices: [{ code: 13, name: "Vereador", covered: false }] },
    { year: 2022, round: 1, offices: [{ code: 7, name: "Deputado Estadual", covered: true }] },
  ],
  parties: [
    { slug: "pcdob", acronym: "PCdoB", name: "PARTIDO COMUNISTA DO BRASIL", numbers: [65], results: [result()] },
    { slug: "pt", acronym: "PT", name: "PARTIDO DOS TRABALHADORES", numbers: [13], results: [result({ partyNumber: 13, votes: 5000, share: 50, elected: 8 })] },
    { slug: "pn", acronym: "PN", name: "PARTIDO NOVO FICTÍCIO", numbers: [99], results: [result({ year: 2024, officeCode: 13, officeName: "Vereador", votes: null, share: null, validVotes: null })] },
  ],
  methodology: "Fatos do TSE.",
  definitions: { votes: "nominais + legenda" },
  freshness: FRESH,
};

const PROFILE: PartyProfileResponse = {
  slug: "pcdob",
  acronym: "PCdoB",
  name: "PARTIDO COMUNISTA DO BRASIL",
  uf: "CE",
  identity: [
    { year: 2022, round: 1, number: 65, acronym: "PCdoB", name: "PARTIDO COMUNISTA DO BRASIL", federations: "FEDERAÇÃO FICTÍCIA" },
    { year: 2018, round: 1, number: 65, acronym: "PC do B", name: "PARTIDO COMUNISTA DO BRASIL", federations: null },
  ],
  results: [
    result({
      federations: "FEDERAÇÃO FICTÍCIA",
      change: { fromYear: 2018, fromRound: 1, fromPartyNumber: 65, fromVotes: 800, fromShare: 8.5, fromElected: 1, deltaVotes: 200, deltaPercent: 25, deltaSharePoints: 1.5, comparability: "comparable", note: "Mesmo cargo e turno." },
    }),
  ],
  detail: {
    year: 2022, round: 1, officeCode: 7, officeName: "Deputado Estadual", partyNumbers: [65],
    strongest: [{ municipalityTseCode: "13935", name: "General Sampaio", slug: "general-sampaio", zone: null, votes: 300, validVotes: 1000, share: 30, candidacies: null, elected: null }],
    weakest: [{ municipalityTseCode: "13897", name: "Fortaleza", slug: "fortaleza", zone: null, votes: 0, validVotes: 900_000, share: 0, candidacies: null, elected: null }],
    territoriesWithVotes: 183, territoriesConsidered: 184,
    candidates: [
      { candidacyId: "c1", politicianId: "p1", slug: "candidata-a", name: "Candidata A", number: 65123, unit: "Ceará", votes: 40_000, elected: true, outcome: "Eleito" },
      { candidacyId: "c2", politicianId: null, slug: null, name: "Candidato B", number: 65456, unit: "Ceará", votes: null, elected: false, outcome: "Suplente" },
    ],
    coverage: { zonesCovered: 100, zonesExpected: 110, complete: false, note: "Cobertura parcial: 100 de 110 zonas com Boletim de Urna." },
    note: "Participação do partido em cada município do estado.",
  },
  notes: ["Grafias da sigla no TSE: PCdoB, PC do B (mesmo endereço)."],
  methodology: "Fatos do TSE.",
  definitions: {},
  freshness: FRESH,
};

let profileResponse: () => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function api(raw: string) {
  const url = new URL(raw);
  if (url.pathname === "/api/v1/parties") return json(LIST);
  if (url.pathname.startsWith("/api/v1/parties/")) return profileResponse();
  return json({ message: "não existe" }, 404);
}

function renderWith(ui: ReactNode, search = "") {
  nav.search = search;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  nav.replace.mockReset();
  profileResponse = () => json(PROFILE);
  vi.stubGlobal("fetch", vi.fn((url: string) => api(url)));
});
afterEach(() => vi.unstubAllGlobals());

describe("partidos — lista", () => {
  it("eleição mais recente COM Boletim de Urna por padrão; ordem por votos; link com o recorte", async () => {
    renderWith(<PartiesExplorer />);
    const list = await screen.findByTestId("party-list");
    expect([...list.querySelectorAll("li")].map((li) => li.getAttribute("data-party"))).toEqual(["pt", "pcdob"]);
    expect(within(list).getByRole("link", { name: "PCdoB" }).getAttribute("href")).toBe("/partidos/pcdob?ano=2022&turno=1&cargo=7&uf=CE");
  });

  it("cargo sem Boletim de Urna: partidos pelas candidaturas, votos em branco (nunca zero)", async () => {
    renderWith(<PartiesExplorer />, "ano=2024&turno=1&cargo=13");
    const list = await screen.findByTestId("party-list");
    expect(screen.getByText("Sem Boletim de Urna deste cargo")).toBeTruthy();
    expect(list.textContent).toContain("—");
    expect(list.textContent).not.toMatch(/\b0 votos|\b0,0%/);
  });

  it("variação só quando comparável", () => {
    expect(changeText(result())).toBe("primeira eleição importada");
    expect(changeText(result({ change: { ...PROFILE.results[0].change!, deltaSharePoints: null, comparability: "coverage_incomplete" } }))).toBe("sem comparação com 2018");
    expect(changeText(result({ change: { ...PROFILE.results[0].change!, comparability: "absent" } }))).toBe("não disputou em 2018");
    expect(changeText(PROFILE.results[0])).toBe("+1,5 p.p. desde 2018");
  });
});

describe("partidos — perfil", () => {
  it("identidade oficial, cobertura parcial, municípios, candidaturas e link para o mapa", async () => {
    renderWith(<PartyProfile slug="pcdob" />, "ano=2022&turno=1&cargo=7");
    const detail = await screen.findByTestId("party-detail");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("PCdoB");
    expect(screen.getByText(/Grafias da sigla no TSE/)).toBeTruthy();
    expect(within(detail).getByText(/Cobertura parcial: 100 de 110 zonas/)).toBeTruthy();
    expect(within(screen.getByTestId("party-strongest")).getByText("General Sampaio")).toBeTruthy();
    const candidates = screen.getByTestId("party-candidates");
    expect(within(candidates).getByRole("link", { name: "Candidata A" }).getAttribute("href")).toBe("/politicos/candidata-a");
    expect(candidates.textContent).toContain("sem vínculo com o BU"); // votos ausentes nunca viram zero
    expect(within(detail).getByRole("link", { name: /Ver no mapa/ }).getAttribute("href")).toBe("/eleicoes/2022/1/ce?camada=party&cargo=7&partido=65");
    expect(screen.getByText(/Federação FEDERAÇÃO FICTÍCIA/, { selector: "span" })).toBeTruthy();
  });

  it("escolher outra eleição × cargo muda a URL", async () => {
    renderWith(<PartyProfile slug="pcdob" />);
    const results = await screen.findByTestId("party-results");
    fireEvent.click(within(results).getAllByRole("button")[0]);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/partidos?ano=2022&turno=1&cargo=7", { scroll: false }));
  });

  it("404 diz que o partido não existe neste estado", async () => {
    profileResponse = () => json({ message: "Partido \"xyz\" sem candidaturas importadas em CE." }, 404);
    renderWith(<PartyProfile slug="xyz" />);
    expect(await screen.findByText("Partido não encontrado neste estado.")).toBeTruthy();
  });
});

describe("partidos — camada do mapa", () => {
  it("participação em um matiz; fora da disputa municipal fica sem cor e diz por quê", () => {
    const layer: MapLayerResponse = {
      year: 2024, round: 1, uf: "CE", municipalityTseCode: null, level: "municipality", officeCode: 11, min: 0, max: 40,
      comparability: null, note: "Participação do partido.", freshness: FRESH, layer: "party", legend: [],
      features: [
        { key: "CE|1", municipalityTseCode: "1", ibgeCode: 1, name: "A", zone: null, placeCode: null, latitude: null, longitude: null, value: 40, category: null, categoryLabel: null, state: "value", details: { votes: 400, elected: 1 } },
        { key: "CE|2", municipalityTseCode: "2", ibgeCode: 2, name: "B", zone: null, placeCode: null, latitude: null, longitude: null, value: 0, category: null, categoryLabel: null, state: "zero", details: { votes: 0, elected: 0 } },
        { key: "CE|3", municipalityTseCode: "3", ibgeCode: 3, name: "C", zone: null, placeCode: null, latitude: null, longitude: null, value: null, category: null, categoryLabel: null, state: "not_on_ballot", details: { votes: null } },
      ],
    };
    const view = buildLayerView(layer);
    expect(view.municipalities["1"].color).toBe(SEQUENTIAL.light.high);
    expect(view.municipalities["1"].text).toBe("40,00% dos válidos · 400 votos · 1 eleito");
    expect(view.municipalities["2"].color).toBe(SEQUENTIAL.light.low); // zero real é colorido (primeiro passo)
    expect(view.municipalities["3"].color).toBeNull();
    expect(view.municipalities["3"].text).not.toMatch(/\b0\b/);
    expect(view.gradient).not.toBeNull();
  });
});
