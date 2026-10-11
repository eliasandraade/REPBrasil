import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUNICIPALITIES, STATES } from "./fixtures";
import { missingSelection, officesFor, parseRankingQuery, rankingSearch, type RankingKind, type RankingResponse } from "@/lib/rankings";

const nav = vi.hoisted(() => ({ pathname: "/rankings", search: "", replace: vi.fn(), push: vi.fn() }));

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

import { RankingsExplorer } from "@/components/rankings/RankingsExplorer";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const KINDS: RankingKind[] = [
  { key: "votes", label: "Mais votados", unit: "votos", definition: "votos nominais", requires: ["year", "round", "office", "uf"], comparability: "mesma disputa", source: "TSE — Boletins de Urna" },
  { key: "share", label: "Maior participação", unit: "% dos válidos", definition: "votos ÷ válidos", requires: ["year", "round", "office", "uf"], comparability: "percentual da própria disputa", source: "TSE — Boletins de Urna" },
  { key: "assets", label: "Patrimônio declarado", unit: "R$", definition: "bens declarados", requires: ["year", "round", "uf"], comparability: "valor declarado", source: "TSE — Bens de candidatos" },
  { key: "recurrence", label: "Recorrência", unit: "candidaturas", definition: "candidaturas da mesma pessoa", requires: ["uf"], comparability: "eleições importadas", source: "TSE — Candidatos" },
];

const ELECTIONS = {
  elections: [
    { year: 2024, round: 1, electionDate: "2024-10-06", description: "1º Turno", cadasterAvailable: true, resultsAvailable: true, default: true },
    { year: 2022, round: 1, electionDate: "2022-10-02", description: "1º Turno", cadasterAvailable: true, resultsAvailable: true, default: false },
  ],
};

const item = (position: number, name: string, votes: number, slug: string) => ({
  position,
  entityKind: "candidacy",
  candidacyId: `c-${slug}`,
  politicianId: `p-${slug}`,
  slug,
  name,
  party: "PF",
  unit: "General Sampaio",
  elected: position === 1,
  value: votes,
  valueText: `${votes.toLocaleString("pt-BR")} votos`,
  details: { office: "Vereador", votes, share: 10.5, outcome: position === 1 ? "Eleito" : null },
});

const RANKING: RankingResponse = {
  kind: KINDS[0],
  filters: { year: 2024, round: 1, office: 13, uf: "CE", municipality: "13935", party: null },
  items: [item(1, "CANDIDATA A", 500, "candidata-a"), item(2, "CANDIDATO B", 400, "candidato-b"), item(2, "CANDIDATO C", 400, "candidato-c"), item(4, "CANDIDATA D", 90, "candidata-d")] as RankingResponse["items"],
  total: 4,
  excluded: 2,
  excludedNote: "2 candidatura(s) fora do ranking: sem vínculo auditado com o Boletim de Urna ou sem despesa declarada (nunca contadas como zero).",
  page: 1,
  pageSize: 50,
  coverage: { zonesCovered: 1, zonesExpected: 2, complete: false, note: "Cobertura parcial: 1 de 2 zonas com Boletim de Urna. Valores de votação são parciais." },
  methodology: "Mais votados: votos nominais. Empates dividem a posição.",
  freshness: null,
};

let rankingResponse: () => Promise<Response> = () => json(RANKING);
const rankingCalls: URL[] = [];

function api(raw: string) {
  const url = new URL(raw);
  if (url.pathname === "/api/v1/rankings/kinds") return json(KINDS);
  if (url.pathname === "/api/v1/rankings") {
    rankingCalls.push(url);
    return rankingResponse();
  }
  if (url.pathname === "/api/v1/elections") return json(ELECTIONS);
  if (url.pathname.endsWith("/states")) return json(STATES);
  if (url.pathname.endsWith("/states/CE/municipalities")) return json(MUNICIPALITIES);
  return json({ message: "não existe" }, 404);
}

function renderAt(search: string) {
  nav.search = search;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RankingsExplorer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  rankingCalls.length = 0;
  rankingResponse = () => json(RANKING);
  vi.stubGlobal("fetch", vi.fn((url: string) => api(url)));
});
afterEach(() => vi.unstubAllGlobals());

describe("rankings — endereço e regras de recorte", () => {
  it("a URL ida e volta preserva o recorte; valores inválidos caem no padrão", () => {
    const q = parseRankingQuery(new URLSearchParams("tipo=participacao&ano=2024&turno=1&cargo=13&uf=ce&municipio=13935&partido=pf&pagina=3"));
    expect(q).toEqual({ kind: "share", year: 2024, round: 1, office: 13, uf: "CE", municipality: "13935", party: "PF", page: 3 });
    expect(parseRankingQuery(new URLSearchParams(rankingSearch(q)))).toEqual(q);
    const bad = parseRankingQuery(new URLSearchParams("tipo=xyz&ano=abc&uf=c3&municipio=x&pagina=-2&partido=<script>"));
    expect(bad).toMatchObject({ kind: "votes", year: null, uf: "CE", municipality: null, party: null, page: 1 });
  });

  it("cargos do ano: municipais em anos múltiplos de 4; gerais nos demais (distrital só no DF)", () => {
    expect(officesFor(2024, "CE").map((o) => o.code)).toEqual([11, 13]);
    expect(officesFor(2022, "CE").map((o) => o.code)).toEqual([1, 3, 5, 6, 7]);
    expect(officesFor(2022, "DF").map((o) => o.code)).toEqual([1, 3, 5, 6, 8]);
  });

  it("vereador sem município não é consultado: cada município é uma disputa", () => {
    const q = parseRankingQuery(new URLSearchParams("tipo=mais-votados&ano=2024&turno=1&cargo=13&uf=CE"));
    expect(missingSelection(q, KINDS[0])).toMatch(/município/);
    expect(missingSelection({ ...q, kind: "share" }, KINDS[1])).toBeNull();
    expect(missingSelection({ ...q, office: null }, KINDS[0])).toMatch(/cargo/);
  });
});

describe("rankings — tela", () => {
  it("sem eleição na URL usa a eleição padrão do catálogo (replace)", async () => {
    renderAt("tipo=mais-votados");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/rankings?tipo=mais-votados&ano=2024&turno=1&uf=CE", { scroll: false }));
  });

  it("recorte incompatível explica o que escolher e não consulta o ranking", async () => {
    renderAt("tipo=mais-votados&ano=2024&turno=1&cargo=13&uf=CE");
    expect(await screen.findByText(/disputas diferentes em cada município/)).toBeTruthy();
    expect(rankingCalls).toHaveLength(0);
  });

  it("lista com empates na mesma posição, cobertura parcial, excluídas e link para o perfil", async () => {
    renderAt("tipo=mais-votados&ano=2024&turno=1&cargo=13&uf=CE&municipio=13935");
    const list = await screen.findByTestId("ranking-list");
    expect([...list.querySelectorAll("li")].map((li) => li.getAttribute("data-position"))).toEqual(["1", "2", "2", "4"]);
    expect(screen.getByText(/Cobertura parcial: 1 de 2 zonas/)).toBeTruthy();
    expect(screen.getByText(/nunca contadas como zero/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "CANDIDATA A" }).getAttribute("href")).toBe("/politicos/candidata-a");
    const call = rankingCalls[0];
    expect(Object.fromEntries(call.searchParams)).toMatchObject({ kind: "votes", year: "2024", round: "1", office: "13", uf: "CE", municipality: "13935" });
  });

  it("carregando nunca mostra zero", async () => {
    rankingResponse = () => new Promise(() => {});
    const { container } = renderAt("tipo=mais-votados&ano=2024&turno=1&cargo=13&uf=CE&municipio=13935");
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(container.textContent).not.toMatch(/\b0 (votos|itens)/);
  });

  it("400 da API vira explicação de recorte não comparável", async () => {
    rankingResponse = () => json({ message: "Vice e suplente são votados na chapa: escolha o cargo do titular." }, 400);
    renderAt("tipo=participacao&ano=2024&turno=1&cargo=11&uf=CE");
    expect(await screen.findByText("Recorte não comparável")).toBeTruthy();
    expect(screen.getByText(/Vice e suplente são votados na chapa/)).toBeTruthy();
  });

  it("ranking vazio diz por quê, sem lista de zeros", async () => {
    rankingResponse = () => json({ ...RANKING, items: [], total: 0, coverage: { zonesCovered: 0, zonesExpected: 2, complete: false, note: "Sem Boletim de Urna importado para este cargo no recorte." } });
    renderAt("tipo=mais-votados&ano=2024&turno=1&cargo=13&uf=CE&municipio=13935");
    expect(await screen.findByText("Nenhum item com o dado neste recorte.")).toBeTruthy();
    expect(screen.getByText(/Sem Boletim de Urna importado/)).toBeTruthy();
    expect(screen.queryByTestId("ranking-list")).toBeNull();
  });
});
