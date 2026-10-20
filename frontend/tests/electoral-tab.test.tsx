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
import { PoliticianProfile } from "@/components/politicians/PoliticianProfile";
import { RecordsPanel, TerritoryPanel } from "@/components/xray/CandidacyPanels";
import { XrayTimeline } from "@/components/xray/XrayTimeline";
import { ProfileOverview } from "@/components/politicians/ProfileOverview";
import { useReducedMotion } from "@/lib/elections/reduced-motion";
import { buildLayerView, CATEGORICAL, layerSignature } from "@/lib/elections/map-layers";
import { CATEGORICAL as THEMED, CHOROPLETH_SLOTS, OTHER, SEQUENTIAL } from "@/lib/dataviz/palette";
import { levelCount, MAX_COMPARE, parseSelection, signed, signedPercent, toggleSelection, votesText } from "@/lib/elections/xray";

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

/** URL da chamada de comparação (a conta é consultada antes, para o limite do plano). */
const compareCall = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/elections/compare")) ?? "";

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
  const POLITICIAN = {
    id: "pol-1", name: "Candidata Fictícia de Tal", ballotName: "Candidata Fictícia", tseId: "1", camaraId: null, senateId: null,
    state: "CE", partyAcronym: "XX", partyName: null, office: "PREFEITO", candidacyStatus: null, createdAt: "2026-01-01",
    sourceUpdatedAt: null, slug: "candidata-ficticia",
  };

  function renderProfile() {
    return render(
      <QueryClientProvider client={client()}>
        <PoliticianProfile politician={POLITICIAN} elections={[]} assets={[]} sources={[]} />
      </QueryClientProvider>,
    );
  }

  it("histórico: candidaturas da mais recente à mais antiga, com estados explícitos — nunca zero inventado", () => {
    render(
      <QueryClientProvider client={client()}>
        <XrayTimeline data={XRAY} onOpen={() => {}} />
      </QueryClientProvider>,
    );
    const cards = screen.getAllByTestId("xray-candidacy");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]).getByTestId("xray-votes").textContent).toBe("45.000");
    expect(cards[cards.length - 1].getAttribute("data-candidacy")).toBe(ID(2)); // 2022 por último
    // vereadora sem BU importado: rótulo do estado, nunca "0"
    const vereadora = document.querySelector(`[data-candidacy="${ID(4)}"]`)!;
    expect(within(vereadora as HTMLElement).getByTestId("xray-votes").textContent).toBe("sem Boletim de Urna");
    // vice: votos da chapa, explicitamente
    expect(screen.getByTestId("xray-ticket").textContent).toContain("Chapa: 2.500.000 votos");
    expect(screen.getByTestId("xray-history").textContent).toContain("não importada nesta base");
  });

  it("visão geral: insights em destaque e evolução — comparável com saldo, cargo diferente sem saldo", async () => {
    stubFetch(xrayRoutes(XRAY));
    render(
      <QueryClientProvider client={client()}>
        <ProfileOverview data={XRAY} onOpenTerritory={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("insight-list").textContent).toContain("3º lugar entre 480");
    expect(screen.getByRole("heading", { name: "O que os dados mostram" })).toBeTruthy();
    const evolution = screen.getByTestId("xray-evolution").textContent;
    expect(evolution).toContain("+5.000 votos (+12,5%)");
    expect(evolution).toContain("cargo diferente: sem delta direto");
    expect(evolution).toContain("não indica irregularidade");
    // onde teve mais votos: só territórios com voto apurado (sem cobertura não vira zero nem entra no ranking)
    const top = await screen.findByTestId("profile-top-places");
    expect(top.textContent).toContain("Fortaleza");
    expect(top.textContent).not.toContain("Caucaia");
  });

  it("território: zero nunca inventado para território sem BU", async () => {
    stubFetch(xrayRoutes(XRAY));
    render(
      <QueryClientProvider client={client()}>
        <TerritoryPanel c={XRAY.candidacies[0]} />
      </QueryClientProvider>,
    );
    const list = await screen.findByTestId("xray-territory-list");
    expect(list.textContent).toContain("30.000");
    expect(list.textContent).toContain("sem Boletim de Urna");
  });

  it("registros oficiais: redes declaradas ao TSE (nofollow) e onde o TSE publica propostas e certidões", () => {
    render(<RecordsPanel c={XRAY.candidacies[0]} />);
    const social = within(screen.getByTestId("xray-records")).getByRole("link", { name: "https://example.org/perfil" });
    expect(social.getAttribute("rel")).toContain("nofollow");
    const documents = screen.getByTestId("xray-official-documents");
    expect(documents.textContent).toContain("nº 12345");
    expect(within(documents).getByRole("link", { name: "DivulgaCandContas" }).getAttribute("href")).toBe("https://divulgacandcontas.tse.jus.br/");
  });

  it("candidatura federal desce do município à seção levando a UF da linha", async () => {
    const president = candidacy(1, {
      contest: { year: 2022, round: 2, electionCode: 545, officeCode: 1, officeName: "PRESIDENTE", unit: { scope: "federal", code: "BR", name: "Brasil", uf: null } },
    });
    const fetchMock = stubFetch(xrayRoutes({ ...XRAY, candidacies: [president], evolution: [], assetsEvolution: [] }));
    render(
      <QueryClientProvider client={client()}>
        <TerritoryPanel c={president} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Fortaleza" }));
    fireEvent.click(screen.getByRole("button", { name: "Seção" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((u) => u.includes("level=section") && u.includes("uf=CE") && u.includes("municipality=13897"))).toBe(true);
    });
  });

  it("seleção de comparação respeita o máximo de 5 candidaturas", () => {
    const many = { ...XRAY, candidacies: [1, 2, 5, 6, 7, 8].map((n) => candidacy(n)) };
    render(
      <QueryClientProvider client={client()}>
        <XrayTimeline data={many} onOpen={() => {}} />
      </QueryClientProvider>,
    );
    const boxes = screen.getAllByRole("checkbox", { name: "comparar" }) as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked)).toHaveLength(MAX_COMPARE);
    fireEvent.click(boxes[5]);
    expect(screen.getByText(`Limite de ${MAX_COMPARE} candidaturas.`)).toBeTruthy();
    expect(boxes.filter((b) => b.checked)).toHaveLength(MAX_COMPARE);
    const link = screen.getByRole("link", { name: "Comparar evolução →" });
    expect(link.getAttribute("href")?.split("c=")[1].split("&")[0].split(",")).toHaveLength(MAX_COMPARE);
  });

  it("cabeçalho: quem a pessoa é nas urnas, pela candidatura oficial mais recente (não pelo cadastro antigo)", async () => {
    window.history.replaceState(null, "", "/politicos/candidata-ficticia");
    stubFetch(xrayRoutes(XRAY));
    renderProfile();
    const current = await screen.findByTestId("profile-current");
    expect(current.textContent).toContain("Deputado Estadual · Ceará · Eleições 2026");
    expect(current.textContent).toContain("Eleito por QP");
    expect(current.textContent).not.toContain("Prefeito");
    const facts = screen.getByTestId("profile-facts").textContent;
    expect(facts).toContain("45.000");
    expect(facts).toContain("3º de 480");
    expect(facts).toContain("2 de 3"); // vice (chapa) não conta como resultado próprio
    expect(screen.queryByTestId("profile-legacy")).toBeNull();
  });

  it("do histórico ao território da candidatura, com aba e candidatura na URL (link compartilhável)", async () => {
    window.history.replaceState(null, "", "/politicos/candidata-ficticia?aba=historico");
    stubFetch(xrayRoutes(XRAY));
    renderProfile();
    const cards = await screen.findAllByTestId("xray-candidacy");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Território, bens e contas →" }));
    expect(screen.getByRole("tab", { name: "Território" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByTestId("xray-territory-list");
    await waitFor(() => expect(window.location.search).toBe(`?aba=territorio&candidatura=${ID(1)}`));
    fireEvent.click(screen.getByRole("tab", { name: "Visão geral" }));
    await waitFor(() => expect(window.location.search).toBe(""));
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
    expect(screen.getByRole("link", { name: "Vereadora Um" }).getAttribute("href")).toBe("/politicos/pol-11?aba=raio-x");
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
    expect(intensity.municipalities["1"].color).toBe(SEQUENTIAL.light.high);
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
    expect(view.gradient).toEqual({ from: SEQUENTIAL.light.low, to: SEQUENTIAL.light.high, min: "40,00%", max: "80,00%" });
    expect(view.municipalities["1"].color).toBe(SEQUENTIAL.light.high);
    expect(view.municipalities["2"].text).toBe("PREFEITO 9 · 40,00%");
    expect(view.note).toContain("9 vencedores diferentes");
    expect(view.note).not.toContain("ordem da legenda"); // sem legenda neste modo
  });

  it("coroplético: só os 3 primeiros vencedores ganham cor; o resto vira Outros, com nome no tooltip", () => {
    const legend = Array.from({ length: 5 }, (_, i) => ({ category: ID(i + 1), label: `CANDIDATURA ${i + 1}`, rank: i + 1 }));
    const view = buildLayerView({
      ...base, layer: "winner", min: 40, max: 80, legend,
      features: [feature(1, 60, ID(1), "CANDIDATURA 1"), feature(2, 50, ID(5), "CANDIDATURA 5")],
    });
    expect(view.municipalities["1"].color).toBe(CATEGORICAL[0]);
    expect(view.municipalities["2"].color).toBe(OTHER.light);
    expect(view.municipalities["2"].text).toContain("CANDIDATURA 5");
    expect(view.legend).toHaveLength(CHOROPLETH_SLOTS + 1);
    expect(view.legend.at(-1)?.label).toContain("Outros (2)");
  });

  it("tema escuro usa os passos validados do escuro, nunca as cores de marca", () => {
    const view = buildLayerView({ ...base, layer: "intensity", features: [feature(1, 100)], legend: [] }, "dark");
    expect(view.municipalities["1"].color).toBe(SEQUENTIAL.dark.high);
    const winner = buildLayerView(
      { ...base, layer: "winner", legend: [{ category: ID(1), label: "A", rank: 1 }], features: [feature(1, 60, ID(1), "A")] },
      "dark",
    );
    expect(winner.municipalities["1"].color).toBe(THEMED.dark[0]);
    for (const brand of ["#0B2D5B", "#0F9D58", "#00BAA6"]) {
      expect([...THEMED.light, ...THEMED.dark].map((c) => c.toUpperCase())).not.toContain(brand);
    }
  });

  it("crescimento e queda: a legenda diz o que o cinza significa em cada camada", () => {
    const growth = buildLayerView({ ...base, layer: "growth", features: [feature(1, 10), feature(2, 0)], legend: [] });
    expect(growth.legend.map((l) => l.label)).toEqual(["Crescimento", "Sem crescimento (estável ou queda)"]);
    expect(growth.municipalities["2"].color).toBe(growth.legend[1].color);
    const decline = buildLayerView({ ...base, layer: "decline", features: [feature(1, -10)], legend: [] });
    expect(decline.legend.map((l) => l.label)).toEqual(["Queda", "Sem queda (estável ou crescimento)"]);
  });

  it("A × B entre disputas não comparáveis: motivo e votos lado a lado, sem saldo", () => {
    const ab = buildLayerView({
      ...base, layer: "ab", comparability: "different_office",
      features: [{ ...feature(1, null), state: "comparable", details: { aVotes: 600, bVotes: 20 } }],
      legend: [{ category: "a", label: "GOVERNADOR", rank: 1 }, { category: "b", label: "DEPUTADA", rank: 2 }],
    });
    expect(ab.municipalities["1"].text).toBe("cargo diferente · A 600 × B 20");
    expect(ab.municipalities["1"].color).toBeNull();
  });

  it("assinatura do mapa muda com o texto do local (tooltip nunca fica velho)", () => {
    const one = buildLayerView({
      ...base, layer: "intensity", level: "place",
      features: [{ ...feature(1, 10), key: "CE|1|1|100", latitude: -3.7, longitude: -38.5, details: {} }],
      legend: [],
    });
    const other = { ...one, places: one.places.map((p) => ({ ...p, text: "outro texto" })) };
    expect(layerSignature(one)).not.toBe(layerSignature(other));
  });

  it("contagem por nível com plural correto", () => {
    expect([levelCount("section", 1), levelCount("section", 3), levelCount("place", 2), levelCount("zone", 1234)]).toEqual([
      "1 seção", "3 seções", "2 locais de votação", "1.234 zonas",
    ]);
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
    expect(compareCall(fetchFn)).toContain("level=section");
    expect(matrix.textContent).toContain("+10 (+100%)");
    expect(matrix.textContent).toContain("−5 (−25%)");
    expect(matrix.textContent).toContain("composição da seção mudou");
    expect(screen.getByTestId("compare-overtakes").textContent).toContain("CANDIDATA A passou à frente de CANDIDATO B");
    expect(screen.getByTestId("insight-list").textContent).toContain("passou à frente");
  });

  it("CSV da matriz: estado no lugar de zero, vírgula decimal, ';' e BOM; A × B só com duas da mesma eleição", async () => {
    const { comparisonCsv } = await import("@/lib/elections/compare-csv");
    const columns = [...COMPARE.candidacies];
    const sem = { ...COMPARE.territories[1], cells: [{ ...COMPARE.territories[1].cells[0], votes: null, share: null, state: "no_coverage" as const }] };
    const csv = comparisonCsv({ ...COMPARE, territories: [COMPARE.territories[0], sem] }, columns, "section");
    const lines = csv.split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM: o Excel abre em UTF-8
    expect(lines[0]).toContain("Seção;Candidata A (Deputado Estadual 2022) — votos;Candidata A (Deputado Estadual 2022) — % dos válidos");
    expect(lines[1]).toBe("Zona 1 · seção 100;10;10;20;20;20;20;15;15;comparável");
    expect(lines[2]).toContain("sem Boletim de Urna"); // ausência não vira 0
    expect(lines[2]).toContain("sem candidatura");

    nav.search = `c=${[1, 3].map(ID).join(",")}&uf=CE&nivel=municipality`;
    stubFetch(() => ({ ...COMPARE, level: "municipality", candidacies: [COMPARE.candidacies[0], COMPARE.candidacies[2]], territories: [] }));
    const { unmount } = render(
      <QueryClientProvider client={client()}>
        <ComparisonView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("compare-actions");
    expect(screen.queryByRole("link", { name: "Ver A × B no mapa →" })).toBeNull(); // eleições diferentes
    unmount();
    nav.search = `c=${[1, 2].map(ID).join(",")}&uf=CE&nivel=municipality`;
    stubFetch(() => ({ ...COMPARE, level: "municipality", candidacies: [COMPARE.candidacies[0], COMPARE.candidacies[1]], territories: [] }));
    render(
      <QueryClientProvider client={client()}>
        <ComparisonView />
      </QueryClientProvider>,
    );
    const map = await screen.findByRole("link", { name: "Ver A × B no mapa →" });
    expect(map.getAttribute("href")).toBe(`/eleicoes/2022/1/ce?camada=ab&a=${ID(1)}&b=${ID(2)}`);
    expect(screen.getAllByText(/entre as selecionadas/)).toHaveLength(2);
  });

  it("comparação vazia: explica e monta aqui mesmo (busca a pessoa, escolhe a candidatura, URL atualizada)", async () => {
    nav.search = "";
    stubFetch((url) => {
      if (url.includes("/api/v1/search")) {
        return { query: "candidata", filter: { year: null, round: null, officeCode: null, officeName: null }, order: ["politicians"], territories: [], parties: [], elections: [],
          politicians: [{ id: "pol-1", name: "Candidata Fictícia", ballotName: "Candidata", slug: "candidata", rank: 1, candidacy: null }] };
      }
      return XRAY;
    });
    render(
      <QueryClientProvider client={client()}>
        <ComparisonView />
      </QueryClientProvider>,
    );
    const empty = screen.getByTestId("compare-empty");
    expect(empty.textContent).toContain("Escolha até 5 candidaturas");
    fireEvent.change(within(empty).getByRole("searchbox"), { target: { value: "candidata" } });
    fireEvent.click(await within(empty).findByRole("button", { name: "Candidata" }, { timeout: 3000 }));
    const add = await within(empty).findAllByRole("button", { name: "Adicionar" });
    fireEvent.click(add[0]);
    expect(nav.replace).toHaveBeenCalledWith(`/eleicoes/comparar?c=${ID(1)}&uf=CE`, { scroll: false });
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
    await waitFor(() => expect(compareCall(fetchFn)).not.toBe(""));
    expect(compareCall(fetchFn).match(/candidacy=/g)).toHaveLength(5);
    expect(compareCall(fetchFn)).not.toContain("/extended");
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
