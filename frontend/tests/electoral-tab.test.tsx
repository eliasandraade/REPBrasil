import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonResponse, MapLayerResponse, TerritoryCandidatesResponse, XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";

const nav = vi.hoisted(() => ({ pathname: "/eleicoes/comparar", search: "", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
}));

import { ComparisonView } from "@/components/elections/ComparisonView";
import { TerritoryCandidates } from "@/components/elections/TerritoryCandidates";
import { XrayTab } from "@/components/xray/XrayTab";
import { useReducedMotion } from "@/lib/elections/reduced-motion";
import { buildLayerView, CATEGORICAL } from "@/lib/elections/map-layers";
import { MAX_COMPARE, parseSelection, signed, signedPercent, toggleSelection, votesText } from "@/lib/elections/xray";

const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const FRESH = { stale: false, refreshedAt: "2026-10-10T00:00:00Z", note: "ok" };

function candidacy(n: number, over: Partial<XrayCandidacy> = {}): XrayCandidacy {
  return {
    candidacyId: ID(n),
    tseCandidateId: 60000 + n,
    contest: { year: 2026, round: 1, electionCode: 1, officeCode: 7, officeName: "DEPUTADO ESTADUAL", unit: { scope: "state", code: "CE", name: "Ceará", uf: "CE" } },
    number: 12345,
    ballotName: "CANDIDATA FICTÍCIA",
    party: { number: 12, acronym: "PF", name: "PARTIDO FICTÍCIO" },
    federationAcronym: null,
    coalitionName: null,
    candidacyStatus: "APTO",
    roundOutcome: "ELEITO POR QP",
    elected: true,
    identityStatus: "resolved",
    identityMethod: "cpf_hmac_sha256",
    ticket: null,
    totals: { votes: 45000, validVotes: 4_000_000, shareOfValidVotes: 1.12, rank: 3, candidatesWithVotes: 480, state: "value", coverage: { complete: true, zonesImported: 205, zonesExpected: 205, note: "Todas" } },
    assets: { items: 2, total: 350000 },
    finance: null,
    records: { socialNetworks: ["https://example.org/perfil"], complement: { inserted_in_urn: "SIM", reelection: "N" } },
    source: { source: "TSE", url: "https://cdn.tse.jus.br/x.zip", zipSha256: "abc", member: "consulta_cand_2026_CE.csv", line: 2 },
    ...over,
  };
}

const XRAY: XrayResponse = {
  politicianId: "pol-1",
  personId: "p-1",
  name: "Candidata Fictícia",
  candidacies: [
    candidacy(1),
    candidacy(2, {
      contest: { year: 2022, round: 1, electionCode: 2, officeCode: 7, officeName: "DEPUTADO ESTADUAL", unit: { scope: "state", code: "CE", name: "Ceará", uf: "CE" } },
      roundOutcome: "SUPLENTE",
      elected: false,
      totals: { votes: 40000, validVotes: 3_900_000, shareOfValidVotes: 1.03, rank: 9, candidatesWithVotes: 500, state: "value", coverage: { complete: true, zonesImported: 205, zonesExpected: 205, note: "Todas" } },
    }),
    candidacy(3, {
      contest: { year: 2026, round: 1, electionCode: 1, officeCode: 4, officeName: "VICE-GOVERNADOR", unit: { scope: "state", code: "CE", name: "Ceará", uf: "CE" } },
      ticket: { role: "vice", headCandidacyId: ID(9), headBallotName: "GOVERNADOR FICTÍCIO", headOfficeCode: 3, headVotes: 2_500_000, headShare: 54.2, note: "Votado(a) na chapa de GOVERNADOR FICTÍCIO (Governador): os votos são da chapa." },
      totals: { votes: null, validVotes: null, shareOfValidVotes: null, rank: null, candidatesWithVotes: null, state: "ticket_member", coverage: { complete: true, zonesImported: 205, zonesExpected: 205, note: "" } },
    }),
    candidacy(4, {
      contest: { year: 2024, round: 1, electionCode: 3, officeCode: 13, officeName: "VEREADOR", unit: { scope: "municipal", code: "13897", name: "Fortaleza", uf: "CE" } },
      totals: { votes: null, validVotes: null, shareOfValidVotes: null, rank: null, candidatesWithVotes: null, state: "no_coverage", coverage: { complete: false, zonesImported: 0, zonesExpected: 15, note: "" } },
    }),
  ],
  officialHistory: [{ year: 2020, round: 1, tseCandidateId: 1, officeCode: 13, officeName: "Vereador", unit: "13897", unitName: "FORTALEZA", number: 12345, ballotName: "CANDIDATA", partyAcronym: "PF", outcome: "Suplente", imported: false, candidacyId: null }],
  evolution: [
    { fromCandidacyId: ID(2), toCandidacyId: ID(1), comparability: "comparable_contest", fromVotes: 40000, toVotes: 45000, deltaVotes: 5000, deltaPercent: 12.5, fromShare: 1.03, toShare: 1.12, deltaSharePoints: 0.09 },
    { fromCandidacyId: ID(4), toCandidacyId: ID(1), comparability: "different_office", fromVotes: null, toVotes: 45000, deltaVotes: null, deltaPercent: null, fromShare: null, toShare: 1.12, deltaSharePoints: null },
  ],
  assetsEvolution: [{ fromCandidacyId: ID(2), toCandidacyId: ID(1), fromTotal: 150000, toTotal: 350000, delta: 200000, deltaPercent: 133.33, added: 1, removed: 1, kept: 1 }],
  insights: [{ code: "rank_in_contest", values: { rank: 3 }, text: "3º lugar entre 480 números votados para Deputado Estadual (Ceará) em 2026, com 45.000 votos." }],
  freshness: FRESH,
  definitions: {},
};

const TERRITORY = {
  candidacyId: ID(1), contest: XRAY.candidacies[0].contest, level: "municipality", municipalityTseCode: null, zone: null,
  territories: [
    { uf: "CE", municipalityTseCode: "13897", municipalityName: "Fortaleza", zone: null, section: null, sectionMembers: null, placeCode: null, placeName: null, latitude: null, longitude: null, votes: 30000, validVotes: 1_000_000, share: 3, eligible: null, turnout: null, urns: 10, state: "value" },
    { uf: "CE", municipalityTseCode: "13730", municipalityName: "Caucaia", zone: null, section: null, sectionMembers: null, placeCode: null, placeName: null, latitude: null, longitude: null, votes: null, validVotes: null, share: null, eligible: null, turnout: null, urns: 0, state: "no_coverage" },
  ],
  summary: { votes: 30000, territoriesWithVotes: 1, territoriesCovered: 1, topFiveConcentration: 100, hhi: 10000, best: null, worst: null, bestShare: null },
  insights: [], freshness: FRESH, definitions: {},
};

/** Raio X e território, roteados pela URL (cada endpoint com o seu contrato). */
const xrayRoutes = (xray: unknown) => (url: string) => (url.includes("/territory") ? TERRITORY : xray);

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function stubFetch(handler: (url: string) => unknown) {
  const fn = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(handler(url)), { status: 200 })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  nav.search = "";
  nav.replace.mockReset();
});

describe("Raio X do perfil", () => {
  it("mostra candidaturas com estados explícitos — nunca zero inventado", async () => {
    stubFetch(xrayRoutes(XRAY));
    render(
      <QueryClientProvider client={client()}>
        <XrayTab politicianId="pol-1" />
      </QueryClientProvider>,
    );
    await screen.findByTestId("xray");
    const cards = screen.getAllByTestId("xray-candidacy");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]).getByTestId("xray-votes").textContent).toBe("45.000");
    // vereadora sem BU importado: rótulo do estado, nunca "0"
    const vereadora = document.querySelector(`[data-candidacy="${ID(4)}"]`)!;
    expect(within(vereadora as HTMLElement).getByTestId("xray-votes").textContent).toBe("sem Boletim de Urna");
    // vice: votos da chapa, explicitamente
    expect(screen.getByTestId("xray-ticket").textContent).toContain("Chapa: 2.500.000 votos");
    // evolução: comparável com delta; cargo diferente sem delta
    expect(screen.getByTestId("xray-evolution").textContent).toContain("+5.000 votos (+12,5%)");
    expect(screen.getByTestId("xray-evolution").textContent).toContain("cargo diferente: sem delta direto");
    expect(screen.getByTestId("xray-evolution").textContent).toContain("não indica irregularidade");
    expect(screen.getByTestId("insight-list").textContent).toContain("3º lugar entre 480");
    expect(screen.getByTestId("xray-history").textContent).toContain("não importada nesta base");
    // detalhe territorial: zero nunca inventado para território sem BU
    const list = await screen.findByTestId("xray-territory-list");
    expect(list.textContent).toContain("30.000");
    expect(list.textContent).toContain("sem Boletim de Urna");
    // registros oficiais: redes declaradas ao TSE e onde o TSE publica propostas e certidões
    fireEvent.click(screen.getByRole("tab", { name: "Registros" }));
    const social = within(screen.getByTestId("xray-records")).getByRole("link", { name: "https://example.org/perfil" });
    expect(social.getAttribute("rel")).toContain("nofollow");
    const documents = screen.getByTestId("xray-official-documents");
    expect(documents.textContent).toContain("nº 12345");
    expect(within(documents).getByRole("link", { name: "DivulgaCandContas" }).getAttribute("href")).toBe("https://divulgacandcontas.tse.jus.br/");
  });

  it("seleção de comparação respeita o máximo de 5 candidaturas", async () => {
    const many = { ...XRAY, candidacies: [1, 2, 5, 6, 7, 8].map((n) => candidacy(n)) };
    stubFetch(xrayRoutes(many));
    render(
      <QueryClientProvider client={client()}>
        <XrayTab politicianId="pol-1" />
      </QueryClientProvider>,
    );
    await screen.findByTestId("xray");
    const boxes = screen.getAllByRole("checkbox", { name: "comparar" }) as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked)).toHaveLength(MAX_COMPARE);
    fireEvent.click(boxes[5]);
    expect(screen.getByText(`Limite de ${MAX_COMPARE} candidaturas.`)).toBeTruthy();
    expect(boxes.filter((b) => b.checked)).toHaveLength(MAX_COMPARE);
    const link = screen.getByRole("link", { name: "Comparar evolução →" });
    expect(link.getAttribute("href")?.split("c=")[1].split("&")[0].split(",")).toHaveLength(MAX_COMPARE);
  });
});

describe("seleção de comparação", () => {
  it("valida ids, remove duplicatas e corta em 5", () => {
    expect(parseSelection(`${ID(1)},${ID(1)},xx,${ID(2)}`)).toEqual([ID(1), ID(2)]);
    expect(parseSelection([1, 2, 3, 4, 5, 6].map(ID).join(","))).toHaveLength(5);
    const five = [1, 2, 3, 4, 5].map(ID);
    expect(toggleSelection(five, ID(6))).toEqual({ ids: five, rejected: true });
    expect(toggleSelection(five, ID(1)).ids).toHaveLength(4);
  });

  it("texto de votos: estado explícito quando não há contagem", () => {
    expect(votesText(null, "no_coverage")).toBe("sem Boletim de Urna");
    expect(votesText(0, "zero")).toBe("0");
    expect(votesText(null, "outside_contest")).toBe("fora da disputa");
  });
});

const CANDIDATES: TerritoryCandidatesResponse = {
  year: 2024, round: 1, uf: "CE", municipalityTseCode: "13897", municipalityName: "Fortaleza", zone: null, total: 2, page: 1, pageSize: 25,
  items: [
    { candidacyId: ID(11), politicianId: "pol-11", contest: { year: 2024, round: 1, electionCode: 3, officeCode: 13, officeName: "VEREADOR", unit: { scope: "municipal", code: "13897", name: "Fortaleza", uf: "CE" } }, number: 12345, ballotName: "VEREADORA UM", party: { number: 12, acronym: "PF", name: null }, federationAcronym: null, candidacyStatus: "APTO", roundOutcome: "ELEITO POR QP", elected: true, votes: 15000, share: 1.5, rank: 1, state: "value" },
    { candidacyId: ID(12), politicianId: null, contest: { year: 2024, round: 1, electionCode: 3, officeCode: 13, officeName: "VEREADOR", unit: { scope: "municipal", code: "13897", name: "Fortaleza", uf: "CE" } }, number: 54321, ballotName: "FORA DA URNA", party: null, federationAcronym: null, candidacyStatus: "INAPTO", roundOutcome: null, elected: null, votes: null, share: null, rank: null, state: "not_on_ballot" },
  ],
  offices: [{ value: "13", label: "VEREADOR", count: 2 }], parties: [{ value: "PF", label: "PF", count: 1 }], statuses: [], freshness: FRESH,
};

describe("território → candidaturas", () => {
  it("lista com filtros da API, estado explícito e seleção para comparar", async () => {
    const fetchFn = stubFetch(() => CANDIDATES);
    const onToggle = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <TerritoryCandidates year={2024} round={1} uf="CE" municipality="13897" zone={null} selection={[]} onToggleCompare={onToggle} onShowOnMap={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText("Vereadora Um");
    expect(screen.getByText("fora da urna")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vereadora Um" }).getAttribute("href")).toBe("/politico/pol-11?aba=raio-x");
    fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "13" } });
    fireEvent.change(screen.getByLabelText("Eleito"), { target: { value: "1" } });
    await waitFor(() => {
      const url = String(fetchFn.mock.calls.at(-1)?.[0]);
      expect(url).toContain("/api/v1/elections/2024/1/states/CE/candidates?");
      expect(url).toContain("municipality=13897");
      expect(url).toContain("office=13");
      expect(url).toContain("elected=true");
    });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "comparar" })[0]);
    expect(onToggle).toHaveBeenCalledWith(ID(11));
  });
});

describe("camadas do mapa", () => {
  const base: Omit<MapLayerResponse, "layer" | "features" | "legend"> = {
    year: 2026, round: 1, uf: "CE", municipalityTseCode: null, level: "municipality", officeCode: 3, min: null, max: null, comparability: null, note: "", freshness: FRESH,
  };
  const feature = (ibge: number, value: number | null, category: string | null = null, label: string | null = null) => ({
    key: `CE|${ibge}`, municipalityTseCode: String(ibge), ibgeCode: ibge, name: `M${ibge}`, zone: null, placeCode: null, latitude: null, longitude: null,
    value, category, categoryLabel: label, state: value === null ? "no_coverage" : "value", details: { votes: value, share: 10 },
  });

  it("mais votado usa paleta neutra pela ORDEM da legenda (nunca cor de partido)", () => {
    const view = buildLayerView({
      ...base, layer: "winner",
      features: [feature(1, 55, ID(1), "A"), feature(2, 60, ID(2), "B"), feature(3, null)],
      legend: [{ category: ID(2), label: "B", rank: 1 }, { category: ID(1), label: "A", rank: 2 }],
    });
    expect(view.municipalities["2"].color).toBe(CATEGORICAL[0]);
    expect(view.municipalities["1"].color).toBe(CATEGORICAL[1]);
    expect(view.municipalities["3"].color).toBeNull();
    expect(view.legend.map((l) => l.label)).toEqual(["B", "A"]);
  });

  it("intensidade é sequencial; crescimento e queda divergem; sem valor fica sem cor", () => {
    const intensity = buildLayerView({ ...base, layer: "intensity", features: [feature(1, 100), feature(2, 50), feature(3, null)], legend: [] });
    expect(intensity.municipalities["1"].color).toBe("#0dd48e");
    expect(intensity.municipalities["3"].color).toBeNull();
    expect(intensity.municipalities["3"].text).toBe("sem Boletim de Urna");
    expect(intensity.gradient).not.toBeNull();
    const growth = buildLayerView({
      ...base, layer: "growth",
      features: [
        { ...feature(1, 10), details: { deltaVotes: 10, deltaPercent: 100 } },
        { ...feature(2, -5), details: { deltaVotes: -5, deltaPercent: -25 } },
      ],
      legend: [],
    });
    expect(growth.municipalities["1"].text).toBe("+10 votos (+100%)");
    expect(growth.municipalities["2"].text).toBe("−5 votos (−25%)");
    expect(growth.municipalities["1"].color).not.toBe(growth.municipalities["2"].color);
  });

  it("sem delta: o tooltip diz o motivo em português e mostra os dois valores lado a lado", () => {
    const changed = buildLayerView({
      ...base, layer: "growth",
      features: [{ ...feature(1, null), details: { deltaVotes: null, comparability: "section_composition_changed", fromVotes: 5, toVotes: 7 } }],
      legend: [],
    });
    expect(changed.municipalities["1"].text).toBe("composição da seção mudou · 5 → 7 votos");
    expect(changed.municipalities["1"].color).toBeNull();
    // disputas de cargos diferentes: o motivo é da disputa, mesmo onde o território seria comparável
    const otherOffice = buildLayerView({
      ...base, layer: "decline", comparability: "different_office",
      features: [{ ...feature(1, null), details: { deltaVotes: null, comparability: "comparable", fromVotes: 40000, toVotes: 45000 } }],
      legend: [],
    });
    expect(otherOffice.municipalities["1"].text).toBe("cargo diferente · 40.000 → 45.000 votos");
    const missing = buildLayerView({
      ...base, layer: "growth",
      features: [{ ...feature(1, null), details: { deltaVotes: null, comparability: "coverage_or_section_missing", fromVotes: null, toVotes: 7 } }],
      legend: [],
    });
    expect(missing.municipalities["1"].text).toBe("sem cobertura ou seção inexistente");
  });

  it("muitos vencedores distintos (prefeitos no estado): cor pela % do vencedor, sem repetir cores", () => {
    const legend = Array.from({ length: 9 }, (_, i) => ({ category: ID(i + 1), label: `PREFEITO ${i + 1}`, rank: i + 1 }));
    const view = buildLayerView({
      ...base, layer: "winner", min: 40, max: 80, legend,
      features: [feature(1, 80, ID(1), "PREFEITO 1"), feature(2, 40, ID(9), "PREFEITO 9")],
    });
    expect(view.legend).toEqual([]);
    expect(view.gradient).toEqual({ from: "#1b3a3a", to: "#0dd48e", min: "40,00%", max: "80,00%" });
    expect(view.municipalities["1"].color).toBe("#0dd48e");
    expect(view.municipalities["2"].text).toBe("PREFEITO 9 · 40,00%");
    expect(view.note).toContain("9 vencedores diferentes");
  });

  it("variações sempre com sinal explícito", () => {
    expect([signed(10), signed(-5), signed(0), signedPercent(12.5), signedPercent(-25), signedPercent(0)]).toEqual([
      "+10", "−5", "0", "+12,5%", "−25%", "0%",
    ]);
  });
});

const COMPARE: ComparisonResponse = {
  level: "section", uf: "CE", municipalityTseCode: "99999", zone: null,
  subjects: [
    { index: 0, politicianId: null, personId: "pa", name: "CANDIDATA A", candidacyIds: [ID(1), ID(3)] },
    { index: 1, politicianId: null, personId: "pb", name: "CANDIDATO B", candidacyIds: [ID(2), ID(4)] },
  ],
  elections: [{ index: 0, year: 2022, round: 1 }, { index: 1, year: 2026, round: 1 }],
  candidacies: [ID(1), ID(2), ID(3), ID(4)].map((id, i) => ({
    candidacyId: id, subject: i % 2, election: i < 2 ? 0 : 1,
    contest: { year: i < 2 ? 2022 : 2026, round: 1, electionCode: 1, officeCode: 7, officeName: "DEPUTADO ESTADUAL", unit: { scope: "state" as const, code: "CE", name: "Ceará", uf: "CE" } },
    number: 1, ballotName: i % 2 ? "CANDIDATO B" : "CANDIDATA A", party: null, candidacyStatus: null, roundOutcome: null, elected: null,
    votes: [10, 20, 20, 15][i], share: null, state: "value" as const,
  })),
  pairs: [],
  territories: [
    {
      key: "CE|99999|1|100", uf: "CE", municipalityTseCode: "99999", municipalityName: "Município Fictício", zone: 1, section: 100, placeCode: null, placeName: null,
      comparability: "comparable", membersByElection: { "0": [100], "1": [100] },
      cells: [[ID(1), 10], [ID(2), 20], [ID(3), 20], [ID(4), 15]].map(([id, v]) => ({ candidacyId: id as string, votes: v as number, validVotes: 100, share: v as number, state: "value" as const })),
      evolution: [
        { subject: 0, fromCandidacyId: ID(1), toCandidacyId: ID(3), comparability: "comparable_contest", deltaVotes: 10, deltaPercent: 100, deltaSharePoints: 10 },
        { subject: 1, fromCandidacyId: ID(2), toCandidacyId: ID(4), comparability: "comparable_contest", deltaVotes: -5, deltaPercent: -25, deltaSharePoints: -5 },
      ],
      leaders: [{ election: 0, candidacyId: ID(2), tie: false }, { election: 1, candidacyId: ID(3), tie: false }],
    },
    {
      key: "CE|99999|1|101", uf: "CE", municipalityTseCode: "99999", municipalityName: "Município Fictício", zone: 1, section: 101, placeCode: null, placeName: null,
      comparability: "section_composition_changed", membersByElection: { "0": [101, 102], "1": [101] },
      cells: [ID(1), ID(2), ID(3), ID(4)].map((id) => ({ candidacyId: id, votes: 5, validVotes: 50, share: 10, state: "value" as const })),
      evolution: [{ subject: 0, fromCandidacyId: ID(1), toCandidacyId: ID(3), comparability: "section_composition_changed", deltaVotes: null, deltaPercent: null, deltaSharePoints: null }],
      leaders: [],
    },
  ],
  overtakes: [{ subject: 0, overtakenSubject: 1, fromElection: 0, toElection: 1, territories: 1, keys: ["CE|99999|1|100"] }],
  extremes: [{ subject: 0, fromCandidacyId: ID(1), toCandidacyId: ID(3), kind: "growth", key: "CE|99999|1|100", label: "Município Fictício · zona 1 · seção 100", deltaVotes: 10, deltaPercent: 100 }],
  insights: [{ code: "overtake", values: {}, text: "CANDIDATA A passou à frente de CANDIDATO B em 1 seção de 2022 para 2026." }],
  freshness: FRESH, definitions: { comparable: "…" },
};

describe("comparação", () => {
  it("matriz com evolução, composição alterada e superação vindas da API", async () => {
    nav.search = `c=${[1, 2, 3, 4].map(ID).join(",")}&uf=CE&nivel=section&municipio=99999`;
    const fetchFn = stubFetch(() => COMPARE);
    render(
      <QueryClientProvider client={client()}>
        <ComparisonView />
      </QueryClientProvider>,
    );
    const matrix = await screen.findByTestId("compare-matrix");
    expect(String(fetchFn.mock.calls[0][0])).toContain("level=section");
    expect(matrix.textContent).toContain("+10 (+100%)");
    expect(matrix.textContent).toContain("−5 (−25%)");
    expect(matrix.textContent).toContain("composição da seção mudou");
    expect(screen.getByTestId("compare-overtakes").textContent).toContain("CANDIDATA A passou à frente de CANDIDATO B");
    expect(screen.getByTestId("insight-list").textContent).toContain("passou à frente");
  });

  it("mais de 5 candidaturas na URL: alerta e só as 5 primeiras vão à API", async () => {
    nav.search = `c=${[1, 2, 3, 4, 5, 6].map(ID).join(",")}&uf=CE&nivel=municipality`;
    const fetchFn = stubFetch(() => ({ ...COMPARE, level: "municipality", territories: [] }));
    render(
      <QueryClientProvider client={client()}>
        <ComparisonView />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Limite de 5");
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(String(fetchFn.mock.calls[0][0]).match(/candidacy=/g)).toHaveLength(5);
  });
});

describe("Reduced Motion", () => {
  it("respeita prefers-reduced-motion", () => {
    // Como no navegador: matchMedia(query).matches reflete o estado atual da preferência.
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    let reduce = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return reduce;
        },
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l),
        removeEventListener: vi.fn(),
      })),
    );
    window.matchMedia = globalThis.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    reduce = false;
    act(() => listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent)));
    expect(result.current).toBe(false);
  });
});
