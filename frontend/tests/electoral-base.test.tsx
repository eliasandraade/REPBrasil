import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapLayerResponse, TerritoryValue, XrayCandidacy } from "@/lib/elections/xray-types";
import type { ElectoralBaseResponse, TerritoryBase } from "@/lib/elections/base";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ElectoralBasePanel } from "@/components/xray/ElectoralBasePanel";
import { BASE_CLASS_LABEL, baseClassColor } from "@/lib/elections/base";
import { buildLayerView } from "@/lib/elections/map-layers";
import { ORDINAL_5 } from "@/lib/dataviz/palette";

const ID = "00000000-0000-0000-0000-00000000a024";
const FRESH = { stale: false, refreshedAt: "2026-10-10T00:00:00Z", note: "ok" };

const CANDIDACY = {
  candidacyId: ID,
  contest: { year: 2022, round: 1, electionCode: 546, officeCode: 7, officeName: "DEPUTADO ESTADUAL", unit: { scope: "state", code: "CE", name: "Ceará", uf: "CE" } },
} as unknown as XrayCandidacy;

const territory = (code: string, name: string, votes: number | null, share: number | null): TerritoryValue => ({
  uf: "CE", municipalityTseCode: code, municipalityName: name, zone: null, section: null, sectionMembers: null, placeCode: null, placeName: null,
  latitude: null, longitude: null, votes, validVotes: votes === null ? null : 10_000, share, eligible: null, turnout: null, urns: 1,
  state: votes === null ? "no_coverage" : "value",
});

const row = (key: string, name: string, votes: number | null, share: number | null, cls: TerritoryBase["class"], score: number | null): TerritoryBase => ({
  key, territory: territory(key, name, votes, share), rank: votes === null ? null : 1, contestants: votes === null ? null : 40,
  leaderVotes: votes, marginPoints: votes === null ? null : 3.5, sharePercentile: null, volumePercentile: null, score, class: cls,
  components: score === null ? [] : [
    { key: "position", value: 1, weight: 0.5, contribution: 0.5 },
    { key: "leader_ratio", value: 0.9, weight: 0.5, contribution: 0.45 },
  ],
  change: null,
});

const BASE: ElectoralBaseResponse = {
  candidacyId: ID,
  contest: CANDIDACY.contest,
  level: "municipality",
  municipalityTseCode: null,
  zone: null,
  formula: {
    version: "electoral-base/v1",
    components: [
      { key: "share_percentile", label: "Participação relativa", weight: 0.35, definition: "percentil da participação" },
      { key: "position", label: "Posição na disputa", weight: 0.25, definition: "1º = 1" },
      { key: "leader_ratio", label: "Proximidade do 1º", weight: 0.25, definition: "votos ÷ votos do 1º" },
      { key: "volume_percentile", label: "Volume relativo", weight: 0.15, definition: "percentil dos votos" },
    ],
    classes: [
      { key: "stronghold", label: "Fortaleza eleitoral", minScore: 0.8 },
      { key: "strong", label: "Forte", minScore: 0.6 },
      { key: "competitive", label: "Competitivo", minScore: 0.4 },
      { key: "weak", label: "Fraco", minScore: 0.2 },
      { key: "very_weak", label: "Muito fraco", minScore: 0 },
    ],
    minTerritoriesForPercentiles: 5,
    note: "Classificação descritiva da votação; não é previsão nem recomendação.",
  },
  summary: {
    votes: 4078, territories: 3, territoriesWithVotes: 2, capillarity: 66.67, hhi: 5200, topFiveConcentration: 100,
    classCounts: { stronghold: 1, strong: 0, competitive: 1, weak: 0, very_weak: 0 }, leading: 2, competitive: 1, critical: 0,
  },
  territories: [
    row("13935", "General Sampaio", 4000, 40, "stronghold", 0.95),
    row("13730", "Caucaia", 78, 0.5, "competitive", 0.45),
    row("13897", "Fortaleza", null, null, null, null),
  ],
  highlights: { strongest: ["13935"], weakest: [], competitive: ["13730"], highestShare: [], highestVolume: [], growth: [], decline: [], gainedPosition: [], lostPosition: [], critical: [] },
  comparedWith: null,
  insights: [],
  freshness: FRESH,
  definitions: {},
};

let response: () => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ElectoralBasePanel c={CANDIDACY} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  response = () => json(BASE);
  vi.stubGlobal("fetch", vi.fn(() => response()));
});
afterEach(() => vi.unstubAllGlobals());

describe("Base Eleitoral — painel", () => {
  it("classe, decomposição e versão da fórmula; território sem BU não é classificado nem vira zero", async () => {
    renderPanel();
    const list = await screen.findByTestId("base-territories");
    const items = [...list.querySelectorAll("li")];
    expect(items.map((li) => li.getAttribute("data-class"))).toEqual(["stronghold", "competitive", "none"]);
    const missing = items[2];
    expect(missing.textContent).toContain("Não classificado");
    expect(missing.textContent).not.toMatch(/\b0 ·/);
    expect(within(missing).queryByRole("button", { name: "Por quê?" })).toBeNull();

    fireEvent.click(within(items[0]).getByRole("button", { name: "Por quê?" }));
    const decomposition = screen.getByTestId("base-decomposition");
    expect(decomposition.textContent).toContain("Posição na disputa");
    expect(decomposition.textContent).toContain("Proximidade do 1º");
    expect(decomposition.textContent).toContain(BASE_CLASS_LABEL.stronghold);
    expect(screen.getByTestId("base-formula").textContent).toContain("electoral-base/v1");
  });

  it("carregando nunca mostra zero", async () => {
    response = () => new Promise(() => {});
    const { container } = renderPanel();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it("400 explica por que a base não se aplica (ex.: vice)", async () => {
    response = () => json({ message: "Vice e suplente são votados na chapa: veja a candidatura titular." }, 400);
    renderPanel();
    expect(await screen.findByText("Base eleitoral não se aplica")).toBeTruthy();
    expect(screen.getByText(/votados na chapa/)).toBeTruthy();
  });

  it("disputa nacional (Presidente) é vista estado a estado: UF padrão CE e troca pela tela", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(url);
      return json(BASE);
    }));
    const president = {
      candidacyId: ID,
      contest: { year: 2022, round: 1, electionCode: 545, officeCode: 1, officeName: "PRESIDENTE", unit: { scope: "federal", code: "BR", name: "Brasil", uf: null } },
    } as unknown as XrayCandidacy;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ElectoralBasePanel c={president} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("base-territories");
    expect(new URL(calls[0]).searchParams.get("uf")).toBe("CE");
    fireEvent.change(screen.getByRole("combobox", { name: /Estado/ }), { target: { value: "SP" } });
    await waitFor(() => expect(calls.some((u) => new URL(u).searchParams.get("uf") === "SP")).toBe(true));
    expect((await screen.findByRole("link", { name: /Ver a base no mapa/ })).getAttribute("href")).toContain("/sp?camada=base");
  });

  it("503 do arquivo eleitoral não é ausência de votos", async () => {
    response = () => json({ message: "indisponível", status: "unavailable" }, 503);
    renderPanel();
    // 5xx tenta de novo uma vez (falha transitória) antes de mostrar o estado
    expect(await screen.findByText(/Não é ausência de votos/, undefined, { timeout: 4000 })).toBeTruthy();
  });
});

describe("Base Eleitoral — camada do mapa", () => {
  const feature = (ibge: number, category: string | null, label: string | null) => ({
    key: `CE|${ibge}`, municipalityTseCode: String(ibge), ibgeCode: ibge, name: `M${ibge}`, zone: null, placeCode: null, latitude: null, longitude: null,
    value: category ? 0.9 : null, category, categoryLabel: label, state: category ? "value" : "no_coverage", details: { votes: category ? 100 : null, rank: 1, contestants: 3 },
  });
  const layer = (features: MapLayerResponse["features"]): MapLayerResponse => ({
    year: 2022, round: 1, uf: "CE", municipalityTseCode: null, level: "municipality", officeCode: 7, min: null, max: null, comparability: null, note: "",
    freshness: FRESH, layer: "base", features, legend: [],
  });

  it("uma rampa ordinal (um matiz) por classe, na ordem; sem classe fica sem cor", () => {
    const view = buildLayerView(layer([feature(1, "stronghold", "Fortaleza eleitoral"), feature(2, "very_weak", "Muito fraco"), feature(3, null, null)]));
    expect(view.municipalities["1"].color).toBe(ORDINAL_5.light[4]);
    expect(view.municipalities["2"].color).toBe(ORDINAL_5.light[0]);
    expect(view.municipalities["3"].color).toBeNull();
    expect(view.municipalities["1"].text).toBe("Fortaleza eleitoral · 100 votos · 1º de 3");
    expect(view.legend.map((l) => l.label)).toEqual(["Fortaleza eleitoral", "Forte", "Competitivo", "Fraco", "Muito fraco"]);
  });

  it("tema escuro usa os passos escuros da mesma rampa", () => {
    const dark = buildLayerView(layer([feature(1, "strong", "Forte")]), "dark");
    expect(dark.municipalities["1"].color).toBe(baseClassColor("strong", "dark"));
    expect(dark.municipalities["1"].color).toBe(ORDINAL_5.dark[3]);
  });
});
