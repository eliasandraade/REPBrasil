import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniversalCompare } from "@/components/compare/UniversalCompare";
import { nav } from "./support/next";

// O comparador completa a URL com o recorte padrão (router.replace). O export só aparece com a URL já completa:
// assim o CSV, o XLSX e o PDF levam exatamente a URL que a página mostra (contrato do smoke de produção).

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const ELECTION = { year: 2022, round: 1, electionDate: "2022-10-02", description: null, cadasterAvailable: true, resultsAvailable: true, default: true };
const municipality = (ibgeCode: number, name: string) => ({
  tseCode: String(ibgeCode),
  ibgeCode,
  name,
  slug: name.toLowerCase(),
  uf: "CE",
  territoryKnown: true,
  cadasterAvailable: true,
  resultsAvailable: true,
  zones: 1,
});
const INDICATORS = [{ code: "ibge.population", name: "População", unit: "pessoas", provider: "IBGE/SIDRA", description: "", derived: false }];
const value = (code: string, v: number) => ({
  indicatorCode: "ibge.population",
  municipalityIbgeCode: code,
  municipalityName: code,
  period: 2022,
  value: v,
  provider: "IBGE/SIDRA",
  dataset: "Censo 2022",
  retrievedAt: "2026-10-11T00:00:00Z",
});
const party = (slug: string, acronym: string, number: number) => ({
  slug,
  acronym,
  name: acronym,
  numbers: [number],
  results: [
    {
      year: 2022,
      round: 1,
      officeCode: 6,
      officeName: "Deputado Federal",
      partyNumber: number,
      federations: null,
      votes: 1000,
      nominalVotes: 900,
      legendVotes: 100,
      validVotes: 5000,
      share: 20,
      candidacies: 10,
      elected: 2,
      municipalitiesWithVotes: 184,
      municipalitiesCovered: 184,
      change: null,
    },
  ],
});
const PARTIES = {
  uf: "CE",
  elections: [{ year: 2022, round: 1, offices: [{ code: 6, name: "Deputado Federal", covered: true }] }],
  parties: [party("pt", "PT", 13), party("pl", "PL", 22)],
  methodology: "Votos por partido.",
  definitions: {},
  freshness: { stale: false, refreshedAt: null, note: "" },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string) => {
      const url = String(raw);
      if (url.includes("/municipalities"))
        return json({ election: ELECTION, state: { uf: "CE" }, status: "available", municipalities: [municipality(2304400, "Fortaleza"), municipality(2312908, "Sobral")] });
      if (url.endsWith("/api/v1/elections")) return json({ elections: [ELECTION] });
      if (url.includes("/data/indicators")) return json(INDICATORS);
      if (url.includes("/data/values")) return json([value("2304400", 2428708), value("2312908", 203023)]);
      if (url.includes("/api/v1/parties")) return json(PARTIES);
      return json({ authenticated: false });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  nav.pathname = "/";
  nav.search = "";
  nav.replace.mockReset();
});

function renderCompare(search: string) {
  nav.pathname = "/comparar";
  nav.search = search;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UniversalCompare />
    </QueryClientProvider>,
  );
}

describe("comparador: o arquivo exportado leva a mesma URL da página", () => {
  it("municípios sem métricas na URL: grava as métricas e só então oferece o export", async () => {
    renderCompare("tipo=municipio&uf=CE&itens=2304400,2312908&periodo=2022");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("metricas=ibge.population"), { scroll: false }));
    // a URL do teste não muda sozinha: sem as métricas nela, o export não aparece
    expect(screen.queryByTestId("export-actions")).toBeNull();
  });

  it("municípios com a URL completa: o export aparece", async () => {
    renderCompare("tipo=municipio&uf=CE&itens=2304400,2312908&periodo=2022&metricas=ibge.population");
    expect(await screen.findByTestId("export-actions")).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("partidos sem recorte na URL: grava ano, turno e cargo e só então oferece o export", async () => {
    renderCompare("tipo=partido&uf=CE&itens=pt,pl");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("ano=2022"), { scroll: false }));
    expect(screen.queryByTestId("export-actions")).toBeNull();
  });

  it("partidos com a URL completa: o export aparece", async () => {
    renderCompare("tipo=partido&uf=CE&itens=pt,pl&ano=2022&turno=1&cargo=6");
    expect(await screen.findByTestId("export-actions")).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
