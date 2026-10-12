import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElectoralLiveHub } from "@/components/elections/ElectoralLiveHub";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((raw: string) => {
    const url = new URL(raw);
    if (url.pathname.endsWith("/polls")) return json({
      year: 2026,
      round: 1,
      office: 3,
      uf: "CE",
      municipalityTseCode: null,
      methodology: "fonte auditada",
      caveat: "Pesquisa eleitoral é uma estimativa amostral.",
      polls: [{
        id: "11111111-1111-1111-1111-111111111111",
        registrationNumber: "CE-00001/2026",
        institute: "Instituto Exemplo",
        fieldStart: "2026-10-01",
        fieldEnd: "2026-10-03",
        publishedAt: null,
        sampleSize: 1200,
        marginErrorPp: 2.5,
        confidenceLevel: 95,
        methodology: "Entrevistas presenciais",
        sourceUrl: "https://pesqele-divulgacao.tse.jus.br/example",
        retrievedAt: "2026-10-04T12:00:00Z",
        scenarios: [],
      }],
    });
    if (url.pathname.endsWith("/live")) return json({
      year: 2026,
      round: 1,
      office: 3,
      uf: "CE",
      municipalityTseCode: null,
      methodology: "snapshot oficial",
      caveat: "Antes do início ou enquanto o status for parcial, valores podem estar ausentes.",
      snapshot: {
        snapshotId: "22222222-2222-2222-2222-222222222222",
        scope: "state",
        status: "not_started",
        countedSections: null,
        totalSections: null,
        countedPercent: null,
        capturedAt: "2026-10-04T20:00:00Z",
        tseGeneratedAt: null,
        sourceUrl: "https://resultados.tse.jus.br/oficial/example.json",
        results: [{
          position: 1,
          candidacyId: null,
          candidateNumber: 55,
          label: "Candidata Exemplo",
          partyAcronym: "ABC",
          votes: null,
          percentage: null,
          resultStatus: null,
        }],
      },
    });
    return json({}, 404);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("Pesquisas e apuração", () => {
  it("keeps metadata-only polls visible and distinguishes a not-started official snapshot", async () => {
    render(<ElectoralLiveHub />);

    expect(await screen.findByText("CE-00001/2026")).toBeTruthy();
    expect(screen.getByText("± 2,50 p.p.")).toBeTruthy();
    expect(screen.getByText("95,00%")).toBeTruthy();
    expect(screen.getByText(/nenhum percentual de resultado auditado/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByText("NÃO INICIADA")).toBeTruthy());
    expect(screen.getByText("Candidata Exemplo")).toBeTruthy();
    expect(screen.queryByText("0 votos")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
