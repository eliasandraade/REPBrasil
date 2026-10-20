import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataExplorer } from "@/components/data/DataExplorer";
import type { TerritoryCanvasProps } from "@/components/territory/TerritoryCanvas";
import { TerritoryTable, type TableRow } from "@/components/territory/TerritoryTable";
import { resetGeoCache } from "@/lib/elections/geo";
import { nav } from "./support/next";

// O mapa (WebGL) não existe no jsdom: o teste vê o que o explorador entrega a ele.
const canvas = { last: null as TerritoryCanvasProps | null };
vi.mock("@/components/territory/TerritoryCanvas", () => ({
  TerritoryCanvas: (props: TerritoryCanvasProps) => {
    canvas.last = props;
    return (
      <div data-testid="canvas" data-level={props.level} data-view={props.view} data-layer={props.layer?.key ?? ""} data-before={props.before?.label ?? ""}>
        <button type="button" onClick={() => props.onSelect("state", "23")}>mapa: Ceará</button>
        <button type="button" onClick={() => props.onSelect("municipality", "2304400")}>mapa: Fortaleza</button>
      </div>
    );
  },
}));

const feature = (code: string, name: string, uf: string, x: number) => ({
  type: "Feature",
  id: Number(code),
  properties: { code, name, uf },
  geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
});
const UF_MESH = { type: "FeatureCollection", features: [feature("23", "Ceará", "CE", 0), feature("35", "São Paulo", "SP", 2), feature("29", "Bahia", "BA", 4)] };
const CE_MESH = { type: "FeatureCollection", features: [feature("2304400", "Fortaleza", "CE", 0), feature("2304707", "Granjeiro", "CE", 1), feature("2300101", "Abaiara", "CE", 2)] };

const state = (uf: string, name: string, ibgeCode: number, extra: Partial<Record<"socioeconomic" | "elections" | "amendments", unknown[]>> = {}) => ({
  uf,
  name,
  ibgeCode,
  municipalities: 3,
  socioeconomic: [],
  elections: [],
  amendments: [],
  ...extra,
});
const COVERAGE = {
  states: [
    state("BA", "Bahia", 29),
    state("CE", "Ceará", 23, {
      socioeconomic: [
        { indicator: "ibge.population", period: 2022, municipalities: 3 },
        { indicator: "ibge.literacy_rate_15_plus", period: 2022, municipalities: 3 },
      ],
      elections: [{ year: 2026, round: 1, municipalities: 3 }],
      amendments: [{ year: 2024, municipalities: 2, amendments: 3 }],
    }),
    state("SP", "São Paulo", 35),
  ],
};
const INDICATORS = [
  { code: "atlas.idhm", name: "IDHM", unit: "índice", provider: "Atlas", description: "IDHM municipal.", derived: false },
  { code: "ibge.population", name: "População", unit: "pessoas", provider: "IBGE/SIDRA", description: "População municipal.", derived: false },
  { code: "ibge.literacy_rate_15_plus", name: "Taxa de alfabetização (15+)", unit: "%", provider: "IBGE/SIDRA", description: "Alfabetização.", derived: false },
];
const value = (code: string, name: string, v: number, indicator = "ibge.population") => ({
  indicatorCode: indicator,
  municipalityIbgeCode: code,
  municipalityName: name,
  period: 2022,
  value: v,
  provider: "IBGE/SIDRA",
  dataset: "Censo 2022",
  retrievedAt: "2026-10-11T00:00:00Z",
});
const POPULATION = [value("2304400", "Fortaleza", 2428708), value("2300101", "Abaiara", 11000), value("2304707", "Granjeiro", 4841)];
const LITERACY = [value("2304400", "Fortaleza", 94, "ibge.literacy_rate_15_plus"), value("2300101", "Abaiara", 80, "ibge.literacy_rate_15_plus"), value("2304707", "Granjeiro", 76, "ibge.literacy_rate_15_plus")];
const CORRELATION = {
  xIndicator: "ibge.population",
  yMetric: "ibge.literacy_rate_15_plus",
  period: 2022,
  n: 3,
  pearson: 0.9,
  spearman: 1,
  points: [
    { municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", x: 2428708, y: 94 },
    { municipalityIbgeCode: "2300101", municipalityName: "Abaiara", x: 11000, y: 80 },
    { municipalityIbgeCode: "2304707", municipalityName: "Granjeiro", x: 4841, y: 76 },
  ],
  methodology: "Pearson e Spearman.",
  caveat: "Correlação não implica causalidade.",
};
const CLUSTERS = {
  indicator: "ibge.population",
  period: 2022,
  k: 3,
  centroids: [4841, 11000, 2428708],
  methodology: "K-means determinístico.",
  items: [
    { municipalityIbgeCode: "2304707", municipalityName: "Granjeiro", value: 4841, cluster: 0 },
    { municipalityIbgeCode: "2300101", municipalityName: "Abaiara", value: 11000, cluster: 1 },
    { municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", value: 2428708, cluster: 2 },
  ],
};
const PLANS = {
  currency: "BRL",
  interval: "month",
  billing: { available: false, message: null },
  baseline: [],
  capabilities: [
    { key: "map.advanced_modes", kind: "feature", group: "Dados e mapas", label: "Modos avançados do mapa", description: "Relevo, intensidade e antes/depois." },
    { key: "data.correlation_matrix", kind: "feature", group: "Dados e mapas", label: "Matriz de correlação", description: "Todos os pares de uma vez." },
    { key: "data.export_csv", kind: "feature", group: "Dados e mapas", label: "Exportar o recorte (CSV)", description: "CSV com proveniência." },
    { key: "data.export_bulk", kind: "feature", group: "Dados e mapas", label: "Exportação completa da UF (CSV)", description: "Tudo da UF." },
  ],
  plans: [
    { code: "FREE", rank: 0, name: "Gratuito", monthlyPriceCents: 0, recommended: false, summary: "", audience: "", features: {}, limits: {} },
    { code: "ADVANCED", rank: 1, name: "Avançado", monthlyPriceCents: 2490, recommended: true, summary: "", audience: "", features: { "map.advanced_modes": true, "data.correlation_matrix": true, "data.export_csv": true }, limits: {} },
    { code: "PROFESSIONAL", rank: 2, name: "Profissional", monthlyPriceCents: 6990, recommended: false, summary: "", audience: "", features: { "map.advanced_modes": true, "data.correlation_matrix": true, "data.export_csv": true, "data.export_bulk": true }, limits: {} },
  ],
};
const ADVANCED_SESSION = {
  authenticated: true,
  id: "u1",
  email: "ana@example.test",
  displayName: "Ana",
  avatarUrl: null,
  csrfToken: "c",
  sessionExpiresAt: "2026-11-19T12:00:00Z",
  role: "user",
  plan: "ADVANCED",
  planSource: "subscription",
  capabilities: { "map.advanced_modes": true, "data.correlation_matrix": true, "data.export_csv": true, "data.export_bulk": false },
  limits: {},
  subscription: null,
  profile: null,
  usage: { favorites: 0, watchlist: 0, alerts: 0, unreadNotifications: 0 },
};

let session: unknown = { authenticated: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetGeoCache();
  canvas.last = null;
  session = { authenticated: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string) => {
      const url = String(raw);
      if (url.includes("/geo/br-uf.json")) return json(UF_MESH);
      if (url.includes("/geo/municipios/CE.json")) return json(CE_MESH);
      if (url.includes("/geo/municipios/")) return json({ type: "FeatureCollection", features: [feature("3550308", "São Paulo", "SP", 0)] });
      if (url.includes("/data/coverage")) return json(COVERAGE);
      if (url.includes("/data/indicators")) return json(INDICATORS);
      if (url.includes("/data/values")) return json(url.includes("literacy") ? LITERACY : POPULATION);
      if (url.includes("/data/correlation-matrix")) return json({ error: "plan_required" }, 403);
      if (url.includes("/data/correlation")) return json(CORRELATION);
      if (url.includes("/data/clusters")) return json(CLUSTERS);
      if (url.includes("/territories/states/")) return json([]);
      if (url.includes("/account/session")) return json(session);
      if (url.includes("/api/v1/plans")) return json(PLANS);
      if (url.includes("/states/CE/candidates")) return json({ items: [], offices: [{ value: "3", label: "GOVERNADOR", count: 2 }], total: 0 });
      if (url.includes("/states/CE/map")) return json({ year: 2026, round: 1, uf: "CE", municipalityTseCode: null, layer: "winner", level: "municipality", officeCode: 3, features: [], legend: [], min: null, max: null, comparability: null, note: "", freshness: { stale: false, refreshedAt: null, note: "" } });
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  nav.pathname = "/";
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
});

/** Troca a resposta de uma rota do fetch simulado; o resto continua igual. */
function override(match: string, respond: () => Promise<Response> | Response) {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => (String(input).includes(match) ? respond() : base(input, init)));
}

const coverageWith = (extra: Partial<Record<"socioeconomic" | "elections" | "amendments", unknown[]>>) => ({
  states: COVERAGE.states.map((s) => (s.uf === "CE" ? { ...s, ...extra } : s)),
});

function renderExplorer(search: string) {
  nav.pathname = "/dados";
  nav.search = search;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataExplorer />
    </QueryClientProvider>,
  );
}

describe("explorador territorial (/dados)", () => {
  it("no Brasil, a disponibilidade vem da API e toda UF continua navegável", async () => {
    renderExplorer("");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("1 de 27 UFs têm dados socioeconômicos carregados"));
    expect(within(panel).getByText("CE").nextSibling?.textContent).toBe("2 indicadores · 2022");
    const table = await screen.findByTestId("territory-table");
    expect(within(table).getByRole("button", { name: "São Paulo (SP)" })).toBeTruthy();
    expect(table.textContent).toContain("sem dados carregados");
    expect(screen.getByTestId("canvas").dataset.layer).toContain("coverage:socioeconomico");
    expect(screen.getByTestId("explorer-guide")).toBeTruthy();
  });

  it("Brasil → UF → município: cada passo empilha no histórico; a trilha volta", async () => {
    renderExplorer("");
    fireEvent.click(await screen.findByRole("button", { name: "Ceará (CE)" }));
    expect(nav.push).toHaveBeenLastCalledWith("/dados?uf=CE", { scroll: false });
    nav.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "mapa: Ceará" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenLastCalledWith("/dados?uf=CE", { scroll: false });

    nav.push.mockReset();
    renderExplorer("uf=CE&municipio=2304400");
    const trail = screen.getAllByTestId("explorer-trail").at(-1)!;
    await waitFor(() => expect(trail.textContent).toContain("Fortaleza"));
    fireEvent.click(within(trail).getByRole("button", { name: "Ceará" }));
    expect(nav.push).toHaveBeenLastCalledWith("/dados?uf=CE", { scroll: false });
    fireEvent.click(within(trail).getByRole("button", { name: "Brasil" }));
    expect(nav.push).toHaveBeenLastCalledWith("/dados", { scroll: false });
  });

  it("na UF: indicador sem dado aparece desabilitado; leitura com faixa, mediana e fonte", async () => {
    renderExplorer("uf=CE");
    const select = (await screen.findByLabelText("Indicador")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("ibge.population"));
    const idhm = within(select).getByRole("option", { name: "IDHM — sem dados nesta UF" }) as HTMLOptionElement;
    expect(idhm.disabled).toBe(true);
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Mediana11.000 pessoas"));
    expect(panel.textContent).toContain("Fortaleza · 2.428.708 pessoas");
    expect(panel.textContent).toContain("Fonte: IBGE/SIDRA · Censo 2022");
    expect(screen.getByTestId("insights").textContent).toContain("nos municípios do Ceará, População vai de 4.841 pessoas (Granjeiro) a 2.428.708 pessoas (Fortaleza)");
    await waitFor(() => expect(canvas.last?.layer?.key).toBe("socio:CE:ibge.population:2022:light"));
  });

  it("comparação X × Y explica a associação, nunca usa o mesmo indicador nos dois eixos e mantém o aviso de causalidade", async () => {
    renderExplorer("uf=CE");
    const sentence = await screen.findByTestId("association-sentence");
    expect(sentence.textContent).toBe(
      "Só 3 municípios têm os dois dados: poucos para descrever uma associação entre População e Taxa de alfabetização (15+).",
    );
    const partner = screen.getByLabelText("Comparar com") as HTMLSelectElement;
    expect([...partner.options].map((o) => o.value)).toEqual(["ibge.literacy_rate_15_plus"]);
    expect(screen.getByTestId("causality-caveat").textContent).toContain("Correlação não implica causalidade");
    // contrato do smoke de produção (.github/scripts/production-smoke.mjs): na UF, catálogo explícito no seletor
    expect(screen.getByRole("combobox", { name: /^Indicador/ }).querySelectorAll("option").length).toBeGreaterThan(0);
    expect(screen.getByTestId("data-scatter")).toBeTruthy();
    expect(screen.getByTestId("clusters").textContent).toContain("K-means determinístico");
  });

  it("no município: valor, posição na UF e mediana; ausência nunca vira zero", async () => {
    renderExplorer("uf=CE&municipio=2304707");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("4.841 pessoas"));
    expect(panel.textContent).toContain("3º de 3 (do maior para o menor)");
    expect(screen.getByTestId("insights").textContent).toContain("Granjeiro: 4.841 pessoas, 3º de 3 municípios do Ceará");
    expect(canvas.last).toMatchObject({ level: "municipality", municipality: "2304707", stateCode: "23" });
  });

  it("UF sem dado carregado diz o que falta; a malha oficial continua navegável", async () => {
    renderExplorer("uf=SP");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Nenhum indicador socioeconômico carregado para os municípios de São Paulo até agora."));
    expect(panel.textContent).toContain("A malha municipal (IBGE) continua disponível para navegar.");
    expect(canvas.last).toMatchObject({ level: "state", stateCode: "35", layer: null });
  });

  it("trocar de modo ou de vista atualiza a URL sem empilhar histórico", async () => {
    renderExplorer("uf=CE");
    const modes = screen.getByTestId("explorer-modes");
    fireEvent.click(within(modes).getByRole("button", { name: "Emendas" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/dados?uf=CE&modo=emendas", { scroll: false });
    expect(within(modes).getByRole("button", { name: "Socioeconômico" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sem plano: vistas avançadas, matriz e exportação mostram o plano; o mapa segue na vista Mapa", async () => {
    renderExplorer("uf=CE&vista=relevo");
    expect(await screen.findByTestId("plan-gate-map.advanced_modes")).toBeTruthy();
    expect(screen.getByTestId("canvas").dataset.view).toBe("mapa");
    const matrix = await screen.findByTestId("matrix-section");
    await waitFor(() => expect(within(matrix).getByTestId("plan-gate-data.correlation_matrix").textContent).toContain("plano Avançado"));
    const table = await screen.findByTestId("territory-table");
    await waitFor(() => expect(table.textContent).toContain("Baixar CSV do recorte · entrar"));
  });

  it("com o plano: a vista pedida na URL chega ao mapa, com os dois lados do antes/depois", async () => {
    session = ADVANCED_SESSION;
    renderExplorer("uf=CE&vista=comparar");
    await waitFor(() => expect(screen.getByTestId("canvas").dataset.view).toBe("comparar"));
    await waitFor(() => expect(screen.getByTestId("canvas").dataset.before).toBe("Taxa de alfabetização (15+)"));
    expect(screen.queryByTestId("plan-gate-map.advanced_modes")).toBeNull();
  });

  it("clicar no território já aberto não empilha histórico, mesmo com parâmetros a mais na URL", async () => {
    renderExplorer("utm_source=x&uf=ce");
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("button", { name: "mapa: Ceará" }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("socioeconômico: o comparar mostra dois indicadores do mesmo período, então se chama lado a lado", async () => {
    renderExplorer("uf=CE");
    const views = screen.getByTestId("explorer-views");
    expect(within(views).getByRole("button", { name: /Lado a lado/ })).toBeTruthy();
    expect(within(views).queryByRole("button", { name: /Antes\/depois/ })).toBeNull();
  });

  it("eleitoral: o cruzamento com indicadores exige o mesmo ano do pleito", async () => {
    renderExplorer("uf=CE&modo=eleitoral");
    const crossing = await screen.findByTestId("socioelectoral-crossing");
    expect(crossing.textContent).toContain("O cruzamento exige indicador do mesmo ano do pleito (2026).");
    expect(crossing.textContent).toContain("Os indicadores carregados para os municípios do Ceará são de 2022");
  });
});

describe("links antigos sem território (alertas e perfis anteriores ao explorador)", () => {
  it("se só uma UF tem o indicador no período, abre nela sem empilhar histórico", async () => {
    renderExplorer("x=ibge.population&periodo=2022");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dados?uf=CE&x=ibge.population&periodo=2022", { scroll: false }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("se mais de uma UF tem o indicador, fica no Brasil, com a cobertura", async () => {
    const indicator = { indicator: "ibge.population", period: 2022, municipalities: 3 };
    override("/data/coverage", () =>
      json({ states: COVERAGE.states.map((s) => (s.uf === "SP" ? { ...s, socioeconomic: [indicator] } : s)) }),
    );
    renderExplorer("x=ibge.population&periodo=2022");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("2 de 27 UFs têm dados socioeconômicos carregados"));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("cobertura ainda desconhecida", () => {
  it("enquanto a cobertura não chega, nada é dito como ausente", async () => {
    override("/data/coverage", () => new Promise<Response>(() => undefined));
    renderExplorer("uf=SP");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Verificando o que está carregado nesta UF…"));
    expect(panel.textContent).not.toContain("Nenhum indicador");
    expect((screen.getByLabelText("Indicador") as HTMLSelectElement).textContent).toContain("Carregando…");
  });

  it("no Brasil, a lista de UFs continua navegável e diz que está carregando, não 'sem dados'", async () => {
    override("/data/coverage", () => new Promise<Response>(() => undefined));
    renderExplorer("");
    const table = await screen.findByTestId("territory-table");
    expect(table.textContent).toContain("carregando os valores");
    expect(table.textContent).not.toContain("sem dados carregados");
    expect(within(table).getByRole("button", { name: "São Paulo (SP)" })).toBeTruthy();
  });

  it("falha da cobertura: diz que não foi possível verificar, nunca que nada foi carregado", async () => {
    override("/data/coverage", () => json({ error: "indisponível" }, 503));
    renderExplorer("uf=SP");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Não foi possível verificar agora o que está carregado nesta UF."));
    expect(panel.textContent).not.toContain("Nenhum indicador");
    expect(await screen.findByText("Não foi possível carregar a cobertura dos dados")).toBeTruthy();
  });
});

describe("modo eleitoral", () => {
  const feature = (code: string, name: string, category: string | null, label: string | null, share: number | null, margin: number | null) => ({
    key: code,
    municipalityTseCode: null,
    ibgeCode: Number(code),
    name,
    zone: null,
    placeCode: null,
    latitude: null,
    longitude: null,
    value: share,
    category,
    categoryLabel: label,
    state: "comparable",
    details: { marginVotes: margin },
  });
  const map = (features: unknown[]) => ({
    year: 2026,
    round: 1,
    uf: "CE",
    municipalityTseCode: null,
    layer: "winner",
    level: "municipality",
    officeCode: 3,
    features,
    legend: [{ key: "c1", label: "ANA", order: 1 }],
    min: null,
    max: null,
    comparability: null,
    note: "",
    freshness: { stale: false, refreshedAt: null, note: "" },
  });
  const WITH_TIE = [
    feature("2304400", "FORTALEZA", "c1", "ANA", 52.5, 1000),
    feature("2304707", "GRANJEIRO", "c1", "ANA", 60, 300),
    feature("2300101", "ABAIARA", "tie", "Empate", 45, 0),
  ];

  it("empate na primeira colocação não vira candidatura vencedora", async () => {
    override("/states/CE/map", () => json(map(WITH_TIE)));
    renderExplorer("uf=CE&modo=eleitoral");
    const insights = await screen.findByTestId("insights");
    await waitFor(() => expect(insights.textContent).toContain("Ana foi a candidatura mais votada para governador em 2 municípios do Ceará (2026 · 1º turno)."));
    expect(insights.textContent).toContain("1 município teve empate na primeira colocação.");
    expect(insights.textContent).not.toContain("Empate:");
    expect(screen.getByTestId("territory-table").textContent).toContain("empate na 1ª colocação");
  });

  it("no município empatado, o painel diz empate e não mostra margem", async () => {
    override("/states/CE/map", () => json(map(WITH_TIE)));
    renderExplorer("uf=CE&modo=eleitoral&municipio=2300101");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Empate na primeira colocação · 45,0% cada"));
    expect(panel.textContent).not.toContain("Margem");
  });

  it("antes/depois compara sempre com um pleito anterior; no mais antigo, diz que não há", async () => {
    session = ADVANCED_SESSION;
    const pleito = (year: number, round: number) => ({ year, round, municipalities: 3 });
    override("/data/coverage", () => json(coverageWith({ elections: [pleito(2026, 1), pleito(2024, 2), pleito(2024, 1), pleito(2022, 2), pleito(2022, 1)] })));
    override("/states/CE/map", () => json(map(WITH_TIE)));
    renderExplorer("uf=CE&modo=eleitoral&vista=comparar");
    // governador não existe em 2024 (municipal): o padrão é o pleito geral anterior, no mesmo turno
    await waitFor(() => expect(screen.getByTestId("canvas").dataset.before).toBe("Antes: 2022 · 1º turno"));
    const options = [...(screen.getByLabelText("Comparar com o pleito") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["2024 · 2º turno", "2024 · 1º turno", "2022 · 2º turno", "2022 · 1º turno"]);

    renderExplorer("uf=CE&modo=eleitoral&vista=comparar&ano=2022");
    expect(await screen.findByText("Não há pleito anterior a este carregado nesta UF. Escolha um pleito mais recente para comparar.")).toBeTruthy();
  });
});

describe("modo emendas", () => {
  const row = (code: string, name: string, count: number, committed: number | null, committedMissing: number) => ({
    municipalityIbgeCode: code,
    municipalityName: name,
    amendmentCount: count,
    committedAmount: committed,
    committedAmountMissing: committedMissing,
    paidAmount: committed,
    paidAmountMissing: committedMissing,
  });
  const ROWS = [row("2304400", "Fortaleza", 2, 1000, 0), row("2304707", "Granjeiro", 1, 200, 1)];
  const YEARS = [
    { year: 2025, municipalities: 2, amendments: 3 },
    { year: 2024, municipalities: 2, amendments: 3 },
  ];

  it("a soma é só dos valores completos e diz quantos municípios ficaram fora; frases no singular quando é um", async () => {
    override("/data/coverage", () => json(coverageWith({ amendments: YEARS })));
    override("/amendments/map?", () => json(ROWS));
    renderExplorer("uf=CE&modo=emendas");
    const panel = screen.getByTestId("reading-panel");
    await waitFor(() => expect(panel.textContent).toContain("Soma dos valores completos"));
    expect(panel.textContent).toContain("(fora 1 município com soma parcial)");
    const insights = screen.getByTestId("insights");
    expect(insights.textContent).toContain("2 municípios do Ceará foram destino de 3 emendas identificadas por código IBGE.");
    expect(insights.textContent).toContain("1 município tem emenda sem valor publicado");
  });

  it("antes/depois usa um ano anterior; no ano mais antigo, explica em vez de sumir", async () => {
    session = ADVANCED_SESSION;
    override("/data/coverage", () => json(coverageWith({ amendments: YEARS })));
    override("/amendments/map?", () => json(ROWS));
    renderExplorer("uf=CE&modo=emendas&vista=comparar");
    await waitFor(() => expect(screen.getByTestId("canvas").dataset.before).toBe("Antes: 2024"));

    renderExplorer("uf=CE&modo=emendas&vista=comparar&ano=2024");
    expect(await screen.findByText("Não há ano anterior a 2024 carregado nesta UF. Escolha um ano mais recente para comparar.")).toBeTruthy();
  });
});

describe("meu território", () => {
  const withProfile = (capabilities: Record<string, boolean> = {}) => ({
    ...ADVANCED_SESSION,
    capabilities: { ...ADVANCED_SESSION.capabilities, ...capabilities },
    profile: { fullName: null, stateCode: "CE", municipalityIbgeCode: null, municipalityName: null, usageType: null, avatarHidden: false },
  });

  afterEach(() => sessionStorage.clear());

  it("quem tem UF no perfil ganha o atalho para ela, que empilha no histórico", async () => {
    session = withProfile();
    renderExplorer("");
    const shortcut = await screen.findByTestId("home-territory");
    await waitFor(() => expect(shortcut.textContent).toBe("Meu estado: Ceará"));
    fireEvent.click(shortcut);
    expect(nav.push).toHaveBeenLastCalledWith("/dados?uf=CE", { scroll: false });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("com o plano, a primeira visita da sessão abre no território do perfil; depois, Brasil continua Brasil", async () => {
    session = withProfile({ "account.territorial_default": true });
    renderExplorer("");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dados?uf=CE", { scroll: false }));
    nav.replace.mockReset();
    renderExplorer("");
    await screen.findAllByTestId("home-territory");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("sem o plano, nunca muda o território sozinho", async () => {
    session = withProfile();
    renderExplorer("");
    await screen.findByTestId("home-territory");
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("lista de territórios (equivalente ao mapa pelo teclado)", () => {
  const rows: TableRow[] = [
    { code: "1", name: "Água Branca", cells: { v: "10" }, sort: { v: 10 } },
    { code: "2", name: "Baturité", cells: { v: "30" }, sort: { v: 30 } },
    { code: "3", name: "Crato", cells: { v: "sem dado" }, sort: {}, missing: true },
  ];

  function renderTable(onSelect = vi.fn(), onHover = vi.fn()) {
    render(
      <TerritoryTable
        caption="Teste"
        columns={[{ key: "v", label: "Valor", numeric: true }]}
        rows={rows}
        selected={null}
        hovered={null}
        onHover={onHover}
        onSelect={onSelect}
        initialSort={{ key: "v", dir: "desc" }}
        noun="municípios"
      />,
    );
    return { onSelect, onHover };
  }

  const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("button").textContent);

  it("valores ainda não conhecidos: a lista navega, sem dizer 'sem dado'", () => {
    render(
      <TerritoryTable
        caption="Teste"
        columns={[{ key: "v", label: "Valor", numeric: true }]}
        rows={rows}
        selected={null}
        hovered={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
        initialSort={{ key: "v", dir: "desc" }}
        noun="municípios"
        status="loading"
      />,
    );
    const table = screen.getByTestId("territory-table");
    expect(table.textContent).toContain("3 municípios · carregando os valores.");
    expect(table.textContent).not.toContain("sem dado");
    expect(names()).toHaveLength(3);
  });

  it("a ordem pedida pelo recorte muda a ordenação sem perder o filtro", () => {
    const props = {
      caption: "Teste",
      columns: [{ key: "v", label: "Valor", numeric: true }],
      rows,
      selected: null,
      hovered: null,
      onHover: vi.fn(),
      onSelect: vi.fn(),
      noun: "municípios",
    };
    const { rerender } = render(<TerritoryTable {...props} initialSort={{ key: "v", dir: "desc" }} />);
    const filter = screen.getByLabelText("Filtrar municípios pelo nome") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "at" } });
    expect(names()).toEqual(["Baturité", "Crato"]);
    rerender(<TerritoryTable {...props} initialSort={{ key: "name", dir: "desc" }} />);
    expect(names()).toEqual(["Crato", "Baturité"]);
    expect(filter.value).toBe("at");
  });

  it("ordena com ausência sempre ao fim e filtra sem acento", () => {
    renderTable();
    expect(names()).toEqual(["Baturité", "Água Branca", "Crato"]);
    fireEvent.click(screen.getByRole("button", { name: /Valor/ }));
    expect(names()).toEqual(["Água Branca", "Baturité", "Crato"]);
    expect(screen.getAllByRole("columnheader")[1].getAttribute("aria-sort")).toBe("ascending");
    fireEvent.change(screen.getByLabelText("Filtrar municípios pelo nome"), { target: { value: "agua" } });
    expect(names()).toEqual(["Água Branca"]);
  });

  it("um item focável por vez; setas, Home e End percorrem, Enter abre e o foco destaca no mapa", () => {
    const { onSelect, onHover } = renderTable();
    const buttons = screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("button"));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Água Branca");
    expect(onHover).toHaveBeenLastCalledWith("1");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Crato");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.textContent).toBe("Baturité");
    fireEvent.click(document.activeElement!);
    expect(onSelect).toHaveBeenCalledWith("2");
  });
});
