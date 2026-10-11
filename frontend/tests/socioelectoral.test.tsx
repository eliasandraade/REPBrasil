import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocioElectoralPanel } from "@/components/data/SocioElectoralPanel";
import type { XrayCandidacy } from "@/lib/elections/xray-types";

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const federalCandidacy = {
  candidacyId: "00000000-0000-0000-0000-000000000001",
  tseCandidateId: 1,
  contest: {
    year: 2022,
    round: 1,
    electionCode: 544,
    officeCode: 1,
    officeName: "Presidente",
    unit: { scope: "federal", code: "BR", name: "Brasil", uf: null },
  },
  number: 10,
  ballotName: "CANDIDATO TESTE",
  party: null,
  federationAcronym: null,
  coalitionName: null,
  candidacyStatus: "APTO",
  roundOutcome: null,
  elected: null,
  identityStatus: "linked",
  identityMethod: "fixture",
  ticket: null,
  totals: {
    votes: 1,
    validVotes: 1,
    shareOfValidVotes: 100,
    rank: 1,
    candidatesWithVotes: 1,
    state: "value",
    coverage: { complete: true, zonesImported: 1, zonesExpected: 1, note: "fixture" },
  },
  assets: null,
  finance: null,
  records: { socialNetworks: [], complement: null },
  source: { source: "TSE", url: "https://www.tse.jus.br/", zipSha256: "fixture", member: "fixture", line: 1 },
} as XrayCandidacy;

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SocioElectoralPanel candidacy={federalCandidacy} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((raw: RequestInfo | URL) => {
      const url = new URL(typeof raw === "string" ? raw : raw.toString());
      if (url.pathname.endsWith("/indicators")) {
        return json([
          {
            code: "derived.illiteracy_rate_15_plus",
            name: "Taxa de analfabetismo (15+)",
            unit: "%",
            provider: "REPBrasil",
            description: "Complemento da taxa oficial de alfabetização.",
            derived: true,
          },
        ]);
      }
      if (url.pathname.endsWith("/correlation")) {
        return json({
          xIndicator: "derived.illiteracy_rate_15_plus",
          yMetric: "candidacy_share",
          period: 2022,
          n: 5,
          pearson: 0.5,
          spearman: 0.4,
          methodology: "fixture",
          caveat: "Correlação não implica causalidade.",
          points: [
            { municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", x: 5, y: 10 },
            { municipalityIbgeCode: "2304707", municipalityName: "General Sampaio", x: 10, y: 20 },
            { municipalityIbgeCode: "2307650", municipalityName: "Maracanaú", x: 7, y: 12 },
            { municipalityIbgeCode: "2303709", municipalityName: "Caucaia", x: 8, y: 15 },
            { municipalityIbgeCode: "2312908", municipalityName: "Sobral", x: 6, y: 11 },
          ],
        });
      }
      return json({}, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Perfil socioeleitoral", () => {
  it("uses the first covered UF for federal candidacies and keeps the ecological caveat visible", async () => {
    renderPanel();

    expect(await screen.findByText(/Leitura territorial, não individual/)).toBeTruthy();
    expect(screen.getByText(/falácia ecológica/)).toBeTruthy();
    expect(screen.getByText(/Candidatura federal: análise territorial exibida para CE/)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Municípios observados").parentElement?.textContent).toContain("5");
    });

    const calls = vi.mocked(fetch).mock.calls.map(([raw]) => String(raw));
    const correlationCall = calls.find((url) => url.includes("/api/v1/data/correlation"));
    expect(correlationCall).toContain("uf=CE");
    expect(correlationCall).toContain("period=2022");
    expect(correlationCall).toContain("office=1");
  });
});
