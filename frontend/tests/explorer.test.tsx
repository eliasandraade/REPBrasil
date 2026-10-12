import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUNICIPALITIES, MUNICIPALITY_DETAIL, sectionResults, STATES, zoneDetail } from "./fixtures";

const nav = vi.hoisted(() => ({
  pathname: "/eleicoes/2026/1",
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

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

import { ElectionsExplorer } from "@/components/elections/ElectionsExplorer";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const ELECTIONS = {
  elections: [
    { year: 2026, round: 1, electionDate: "2026-10-04", description: "1º Turno", cadasterAvailable: true, resultsAvailable: true, default: true },
    { year: 2024, round: 1, electionDate: "2024-10-06", description: "1º Turno", cadasterAvailable: true, resultsAvailable: true, default: false },
  ],
};

function api(url: string) {
  if (new URL(url).pathname === "/api/v1/elections") return json(ELECTIONS);
  const path = new URL(url).pathname.replace("/api/v1/elections/2026/1", "");
  if (path === "/states") return json(STATES);
  if (path === "/states/ce/municipalities") return json(MUNICIPALITIES);
  const m = /^\/states\/ce\/municipalities\/([^/]+)(?:\/zones\/(\d+)(?:\/sections\/(\d+)\/results)?)?$/.exec(path);
  if (m) {
    const [, slug, zone, section] = m;
    const detail = MUNICIPALITY_DETAIL[slug];
    if (!detail) return json({ message: "não existe" }, 404);
    if (section) return json(sectionResults(Number(section)));
    if (zone) return json(zoneDetail(slug, Number(zone)));
    return json(detail);
  }
  return json({ message: "não existe" }, 404);
}

function renderAt(pathname: string, search = "") {
  nav.pathname = pathname;
  nav.search = search;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ElectionsExplorer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  nav.push.mockReset();
  vi.stubGlobal("fetch", vi.fn((url: string) => api(url)));
});
afterEach(() => vi.unstubAllGlobals());

describe("explorador eleitoral", () => {
  it("mantém o mesmo contêiner cartográfico ao abrir e fechar resultados de seção", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    nav.pathname = "/eleicoes/2026/1/ce/fortaleza/zona/94";
    const content = () => <QueryClientProvider client={client}><ElectionsExplorer /></QueryClientProvider>;
    const view = render(content());
    const map = screen.getByTestId("territory-map");
    nav.pathname = "/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381";
    view.rerender(content());
    await screen.findByTestId("section-results");
    expect(screen.getByTestId("territory-map")).toBe(map);
    expect(map.closest("[inert]")).toBeTruthy();
    nav.pathname = "/eleicoes/2026/1/ce/fortaleza/zona/94";
    view.rerender(content());
    expect(screen.getByTestId("territory-map")).toBe(map);
    expect(map.closest("[inert]")).toBeNull();
    expect(screen.queryByTestId("section-results")).toBeNull();
  });

  it("Brasil: UFs com cadastro navegáveis; sem cadastro resumidas numa frase, sem link", async () => {
    renderAt("/eleicoes/2026/1");
    await screen.findByTestId("state-list");
    expect(document.querySelector('[data-state="CE"]')!.getAttribute("href")).toBe("/eleicoes/2026/1/ce");
    const missing = screen.getByTestId("states-missing");
    expect(missing.textContent).toContain("São Paulo");
    expect(missing.querySelector("a")).toBeNull();
  });

  it("Ceará: lista de municípios vinda do catálogo", async () => {
    renderAt("/eleicoes/2026/1/ce");
    await screen.findByTestId("municipality-list");
    expect([...document.querySelectorAll("[data-municipality]")].map((e) => e.getAttribute("data-municipality"))).toEqual([
      "caucaia",
      "fortaleza",
      "general-sampaio",
    ]);
  });

  it("General Sampaio: zona única é selecionada automaticamente (replace, sem laço no voltar)", async () => {
    renderAt("/eleicoes/2026/1/ce/general-sampaio");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/eleicoes/2026/1/ce/general-sampaio/zona/50", { scroll: false }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Caucaia: três zonas, o usuário escolhe", async () => {
    renderAt("/eleicoes/2026/1/ce/caucaia");
    await screen.findByTestId("zone-list");
    expect([...document.querySelectorAll("[data-zone]")].map((e) => e.getAttribute("data-zone"))).toEqual(["37", "120", "123"]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("Fortaleza: 17 zonas, sem seleção automática", async () => {
    renderAt("/eleicoes/2026/1/ce/fortaleza");
    await screen.findByTestId("zone-list");
    expect(document.querySelectorAll("[data-zone]")).toHaveLength(17);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("deep link de seção abre o resultado com cargo da URL", async () => {
    renderAt("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381", "cargo=1");
    const results = await screen.findByTestId("section-results");
    await waitFor(() => expect(results.dataset.status).toBe("available"));
    expect(screen.getByTestId("candidate-profile-link").getAttribute("href")).toBe("/politicos/pol-1?aba=eleicoes");
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(calls.some((u) => u.endsWith("/zones/94/sections/381/results?office=1"))).toBe(true);
  });

  it("P2: votos da seção A nunca aparecem sob a seção B enquanto B carrega", async () => {
    const pendingB: { release?: () => void } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/sections/29/results")) {
          // B fica pendente até o fim das asserções
          return new Promise<Response>((resolve) => {
            pendingB.release = () => resolve(new Response(JSON.stringify(sectionResults(29)), { status: 200 }));
          });
        }
        return api(url);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    nav.pathname = "/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381";
    nav.search = "";
    const view = render(
      <QueryClientProvider client={client}>
        <ElectionsExplorer />
      </QueryClientProvider>,
    );
    const a = await screen.findByTestId("section-results");
    await waitFor(() => expect(a.dataset.status).toBe("available"));
    expect(document.querySelector('[data-vote="11"]')).toBeTruthy();

    nav.pathname = "/eleicoes/2026/1/ce/fortaleza/zona/94/secao/29";
    view.rerender(
      <QueryClientProvider client={client}>
        <ElectionsExplorer />
      </QueryClientProvider>,
    );
    const b = await screen.findByRole("heading", { name: "Seção 029" });
    const panel = b.closest('[data-testid="section-results"]') as HTMLElement;
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.dataset.status).toBeUndefined();
    expect(document.querySelector("[data-vote]")).toBeNull();
    expect(screen.queryByTestId("metrics")).toBeNull();
    expect(screen.queryByText("Candidata Com Perfil")).toBeNull();
    pendingB.release?.();
  });

  it("seção agregada no cadastro aponta para a principal sem buscar votos próprios", async () => {
    renderAt("/eleicoes/2026/1/ce/caucaia/zona/120/secao/79");
    const results = await screen.findByTestId("section-results");
    expect(results.dataset.aggregated).toBe("true");
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(calls.some((u) => u.includes("/sections/79/results"))).toBe(false);
  });

  it("município inexistente: estado explícito, sem dado inventado", async () => {
    renderAt("/eleicoes/2026/1/ce/cidade-que-nao-existe");
    await screen.findByText("Território não encontrado");
  });

  it("seção fora do cadastro da zona: não encontrada", async () => {
    renderAt("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/999");
    await screen.findByText("Território não encontrado");
  });

  it("troca de eleição sem perder o lugar: mantém UF e município, zona e seção caem", async () => {
    renderAt("/eleicoes/2026/1/ce/fortaleza/zona/1", "cargo=11&painel=candidaturas");
    const switcher = (await screen.findByTestId("election-switcher")) as HTMLSelectElement;
    expect(switcher.value).toBe("2026-1");
    fireEvent.change(switcher, { target: { value: "2024-1" } });
    expect(nav.push).toHaveBeenCalledWith("/eleicoes/2024/1/ce/fortaleza?painel=candidaturas", { scroll: false });
  });

  it("falha da API não vira lista vazia nem zero", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ message: "erro" }, 503)));
    renderAt("/eleicoes/2026/1/ce");
    // erro de servidor tem uma nova tentativa (404 não): a mensagem vem depois dela
    await screen.findByText("Não foi possível carregar o catálogo eleitoral", undefined, { timeout: 4000 });
  });
});
