import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoliticianCandidaciesResponse } from "@/lib/elections/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ElectoralPerformanceTab } from "@/components/politicians/tabs/ElectoralPerformanceTab";
import { useReducedMotion } from "@/lib/elections/reduced-motion";

const RESPONSE: PoliticianCandidaciesResponse = {
  politicianId: "pol-1",
  candidacies: [
    {
      id: "c-1",
      tseCandidateId: 60002537654,
      contest: { year: 2026, round: 1, tseElectionCode: 6259, tseElectionDescription: "Eleições Gerais Estaduais 2026", officeCode: 6, officeName: "DEPUTADO FEDERAL", scope: "state", electoralUnit: "CE" },
      candidateNumber: 5533,
      ballotName: "CANDIDATO FICTÍCIO",
      party: { number: 55, acronym: "PSD", name: "PARTIDO SOCIAL DEMOCRÁTICO" },
      federationAcronym: null,
      coalitionName: "PARTIDO ISOLADO",
      candidacyStatus: null,
      roundOutcome: "SUPLENTE",
      elected: false,
      identityStatus: "resolved",
      personId: "p-1",
      politicianId: "pol-1",
      profileAvailable: true,
      source: { source: "TSE", url: "https://cdn.tse.jus.br/x.zip", zipSha256: "cc7b", member: "consulta_cand_2026_CE.csv", line: 2 },
      performance: {
        votes: 12345,
        coverage: { complete: true, ufs: [{ uf: "CE", complete: true, zonesWithResults: 205, zonesExpected: 205, municipalitiesComplete: 184, municipalitiesWithAnyResult: 184, municipalitiesExpected: 184 }], note: "Todas as seções da disputa estão importadas." },
        municipalities: [
          { uf: "CE", municipalityTseCode: "13897", municipalityName: "Fortaleza", municipalitySlug: "fortaleza", votes: 10000, validVotes: 1000000, shareOfValidVotes: 1, urns: 4000 },
        ],
        municipalitiesWithVotes: 120,
        definitions: {},
      },
    },
    {
      id: "c-2",
      tseCandidateId: 60002537655,
      contest: { year: 2026, round: 1, tseElectionCode: 6259, tseElectionDescription: null, officeCode: 9, officeName: "1º SUPLENTE", scope: "state", electoralUnit: "CE" },
      candidateNumber: 555,
      ballotName: "CANDIDATO FICTÍCIO",
      party: { number: 55, acronym: "PSD", name: null },
      federationAcronym: null,
      coalitionName: null,
      candidacyStatus: null,
      roundOutcome: null,
      elected: null,
      identityStatus: "resolved",
      personId: "p-1",
      politicianId: "pol-1",
      profileAvailable: true,
      source: { source: "TSE", url: "https://cdn.tse.jus.br/x.zip", zipSha256: "cc7b", member: "consulta_cand_2026_CE.csv", line: 3 },
      performance: null,
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("perfil político → desempenho eleitoral", () => {
  it("mostra a candidatura com o partido DAQUELA eleição, votos (fato) e abrangência", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ElectoralPerformanceTab politicianId="pol-1" />
      </QueryClientProvider>,
    );
    await screen.findByTestId("electoral-performance");
    expect(screen.getByTestId("candidacy-votes").textContent).toBe("12.345");
    expect(screen.getByTestId("candidacy-coverage").textContent).toBe("Completa");
    expect(screen.getByText(/nº 5533 · PSD/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fortaleza/CE" }).getAttribute("href")).toBe("/eleicoes/2026/1/ce/fortaleza");
    // sem votação própria: estado explícito, nunca zero
    expect(screen.getByText(/Sem votação própria vinculada/)).toBeTruthy();
    expect(screen.getAllByTestId("candidacy-outcome").map((e) => e.textContent)).toEqual(["Suplente", "Situação não publicada"]);
  });
});

describe("Reduced Motion", () => {
  it("respeita prefers-reduced-motion", () => {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l), removeEventListener: vi.fn() })),
    );
    window.matchMedia = globalThis.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    act(() => listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent)));
    expect(result.current).toBe(false);
  });
});
