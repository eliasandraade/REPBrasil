import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseElectionsPath } from "@/lib/elections/route";
import type { PoliticianDetail } from "@/lib/types";
import { sectionResults } from "./fixtures";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn() }),
  useParams: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, scroll: _s, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { directionBetween, routeDepth } from "@/motion/depth";
import { duration, easing, easingFn } from "@/motion/tokens";
import { Reveal } from "@/motion/reveal";
import { NavigationProvider, TransitionLink } from "@/motion/navigation";
import { identityHint } from "@/motion/identity";
import HomePage from "@/app/page";
import { PoliticianProfile } from "@/components/politicians/PoliticianProfile";
import { SectionResults } from "@/components/elections/SectionResults";
import { SearchInput } from "@/components/politicians/SearchInput";
import { CamaraTab } from "@/components/politicians/tabs/CamaraTab";
import { AppShell } from "@/components/layout/AppShell";

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  nav.pathname = "/";
  nav.push.mockReset();
  nav.replace.mockReset();
  mockMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.navDirection;
  window.history.replaceState(null, "", "/");
});

// ─── Gramática de profundidade ──────────────────────────────────────────────

describe("zoom semântico: direção entre camadas", () => {
  it("ordena as camadas do produto e do território", () => {
    expect(routeDepth("/")).toBe(0);
    expect(routeDepth("/politicos?q=x")).toBe(1);
    expect(routeDepth("/politicos/andre-fernandes")).toBe(2);
    expect(routeDepth("/politico/abc")).toBe(2); // legado (redireciona)
    expect(routeDepth("/politicos")).toBe(1);
    expect(routeDepth("/eleicoes")).toBe(1);
    expect(routeDepth("/eleicoes/2026/1")).toBe(2);
    expect(routeDepth("/eleicoes/2026/1/ce")).toBe(3);
    expect(routeDepth("/eleicoes/2026/1/ce/fortaleza")).toBe(4);
    expect(routeDepth("/eleicoes/2026/1/ce/fortaleza/zona/94")).toBe(5);
    expect(routeDepth("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381?cargo=5")).toBe(6);
  });

  it("aprofundar, emergir e lateral", () => {
    expect(directionBetween("/", "/politicos")).toBe("deeper");
    expect(directionBetween("/politicos?q=a", "/politicos/1")).toBe("deeper");
    expect(directionBetween("/politicos/1", "/politicos")).toBe("shallower");
    expect(directionBetween("/manifesto", "/suporte")).toBe("lateral");
    expect(directionBetween("/eleicoes/2026/1/ce", "/eleicoes/2026/1/ce/fortaleza")).toBe("deeper");
    expect(directionBetween("/eleicoes/2026/1/ce/fortaleza/zona/94", "/eleicoes/2026/1/ce")).toBe("shallower");
  });

  it("do voto para a pessoa é sempre aprofundar; do perfil ao território é emergir", () => {
    expect(directionBetween("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381", "/politicos/1?aba=eleicoes")).toBe("deeper");
    expect(directionBetween("/politicos/1", "/eleicoes/2026/1/ce/fortaleza")).toBe("shallower");
  });
});

// ─── Tokens ─────────────────────────────────────────────────────────────────

describe("tokens de movimento", () => {
  const css = readFileSync(resolve(process.cwd(), "src/motion/motion.css"), "utf-8");

  it("CSS espelha exatamente os tokens de JS", () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(css).toContain(`--motion-${name}: ${ms}ms;`);
    }
    const cssName: Record<string, string> = { precise: "precise", enter: "enter", exit: "exit", traverse: "traverse" };
    for (const [name, curve] of Object.entries(easing)) {
      expect(css).toContain(`--ease-${cssName[name]}: cubic-bezier(${curve.join(", ")});`);
    }
  });

  it("o canvas tem a cor do produto (sem véu claro no meio de uma View Transition)", () => {
    const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8");
    expect(globals).toMatch(/--canvas: #071A2E/i);
    expect(globals).toMatch(/html \{[^}]*background: var\(--canvas\)/);
  });

  it("nenhuma curva quica (dados oficiais não oscilam)", () => {
    for (const curve of Object.values(easing)) {
      expect(curve[1]).toBeGreaterThanOrEqual(0);
      expect(curve[3]).toBeLessThanOrEqual(1);
    }
    const f = easingFn("traverse");
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    let last = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(f(t)).toBeGreaterThanOrEqual(last);
      last = f(t);
    }
  });

  it("Reduced Motion desliga transições de rota, drawer, abas e entradas", () => {
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    for (const sel of ["::view-transition-group(*)", ".drawer", ".tab-indicator", ".nav-marker", ".mi-arrow"]) {
      expect(reduce).toContain(sel);
    }
    // Estados iniciais escondidos só existem sem Reduced Motion.
    const hiddenRules = css.split("@media (prefers-reduced-motion: no-preference)").length - 1;
    expect(hiddenRules).toBeGreaterThanOrEqual(3);
    expect(css).not.toMatch(/^\s*\[data-reveal="pending"\][^{]*\{[^}]*(opacity:\s*0|clip-path)/m);
  });
});

// ─── Revelação ──────────────────────────────────────────────────────────────

describe("revelação na leitura", () => {
  it("com Reduced Motion o conteúdo nasce revelado (nada espera o scroll)", () => {
    mockMatchMedia(true);
    const observe = vi.fn();
    vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe, unobserve: vi.fn(), disconnect: vi.fn() })));
    render(<Reveal data-testid="r">texto oficial</Reveal>);
    expect(screen.getByTestId("r").dataset.reveal).toBe("in");
    expect(observe).not.toHaveBeenCalled();
  });

  it("desmontado antes de revelar, o elemento deixa de ser observado (sem reter nós)", () => {
    const observe = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe, unobserve, disconnect: vi.fn() })));
    vi.resetModules();
    return import("@/motion/reveal").then(({ Reveal: FreshReveal }) => {
      const { unmount } = render(<FreshReveal data-testid="r">texto</FreshReveal>);
      const el = screen.getByTestId("r");
      expect(observe).toHaveBeenCalledWith(el);
      unmount();
      expect(unobserve).toHaveBeenCalledWith(el);
    });
  });

  it("sem IntersectionObserver o conteúdo também nasce revelado", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Reveal data-testid="r">texto</Reveal>);
    expect(screen.getByTestId("r").dataset.reveal).toBe("in");
  });
});

// ─── Transições de rota ─────────────────────────────────────────────────────

describe("transições de rota", () => {
  function link(props: Partial<Parameters<typeof TransitionLink>[0]> = {}) {
    render(
      <NavigationProvider>
        <TransitionLink href="/politicos/1" shareIdentity {...props}>
          <span data-vt="avatar">AB</span>
          <span data-vt="name">Fulano</span>
        </TransitionLink>
      </NavigationProvider>,
    );
    return screen.getByRole("link");
  }

  it("sem View Transitions: navega imediatamente (a animação nunca atrasa a ação)", () => {
    fireEvent.click(link());
    expect(nav.push).toHaveBeenCalledWith("/politicos/1", { scroll: undefined });
  });

  it("com Reduced Motion não inicia View Transition", () => {
    mockMatchMedia(true);
    const start = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    fireEvent.click(link());
    expect(start).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("com suporte: direção no <html>, identidade compartilhada só no elemento clicado e push dentro da transição", async () => {
    let names: string[] = [];
    const start = vi.fn((cb: () => Promise<void>) => {
      names = Array.from(document.querySelectorAll<HTMLElement>("[data-vt]")).map((n) => n.style.viewTransitionName);
      const done = cb();
      return { finished: done, ready: Promise.resolve(), updateCallbackDone: done, skipTransition: vi.fn() };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    window.history.replaceState(null, "", "/politicos?q=f");
    fireEvent.click(link());
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.navDirection).toBe("deeper");
    expect(names).toEqual(["vt-avatar", "vt-name"]);
    expect(nav.push).toHaveBeenCalledWith("/politicos/1", { scroll: undefined });
  });

  it("navegações consecutivas: a anterior é liberada e não apaga a direção da nova; pular a anterior não gera rejeição sem tratamento", async () => {
    const callbacks: Array<Promise<void>> = [];
    const readies: Array<Promise<void>> = [];
    const finishes: Array<() => void> = [];
    (document as { startViewTransition?: unknown }).startViewTransition = vi.fn((cb: () => Promise<void>) => {
      const done = cb();
      callbacks.push(done);
      // A transição anterior é pulada: ready rejeita com AbortError (como no navegador).
      const ready = callbacks.length === 1 ? Promise.reject(new DOMException("skipped", "AbortError")) : Promise.resolve();
      readies.push(ready);
      let finish!: () => void;
      const finished = new Promise<void>((r) => (finish = r));
      finishes.push(finish);
      return { finished, ready, updateCallbackDone: done, skipTransition: vi.fn() };
    });
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    window.history.replaceState(null, "", "/");
    render(
      <NavigationProvider>
        <TransitionLink href="/politicos">busca</TransitionLink>
        <TransitionLink href="/manifesto">manifesto</TransitionLink>
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByText("busca"));
    expect(document.documentElement.dataset.navDirection).toBe("deeper");
    window.history.replaceState(null, "", "/politicos");
    fireEvent.click(screen.getByText("manifesto"));
    // A primeira foi liberada imediatamente (não espera o teto de 1,2 s).
    await expect(callbacks[0]).resolves.toBeUndefined();
    expect(document.documentElement.dataset.navDirection).toBe("lateral");
    // A primeira termina depois: não pode apagar a direção da segunda.
    finishes[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.navDirection).toBe("lateral");
    finishes[1]();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.navDirection).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", unhandled);
  });

  it("clique com modificador abre como link comum (nova aba)", () => {
    fireEvent.click(link(), { ctrlKey: true });
    expect(nav.push).not.toHaveBeenCalled();
  });
});

// ─── Home ───────────────────────────────────────────────────────────────────

describe("home", () => {
  const OVERVIEW = {
    elections: [
      { year: 2026, round: 1, uf: "CE", stateName: "Ceará", municipalities: 184, zones: 109, sections: 23765, eligible: 6996545, offices: [{ code: 3, name: "Governador" }, { code: 5, name: "Senador" }] },
      { year: 2024, round: 2, uf: "CE", stateName: "Ceará", municipalities: 2, zones: 20, sections: 6034, eligible: 2015233, offices: [{ code: 11, name: "Prefeito" }] },
    ],
    candidacies: 15011,
    politicians: 14432,
    sources: [{ kind: "tse-open-data-bu", publisher: "TSE", label: "Boletins de Urna (votos por seção)", files: 5, latestDownload: "2026-10-10T07:05:48Z" }],
    updatedAt: "2026-10-10T20:55:41Z",
  };

  function renderHome(response: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      if (input.endsWith("/overview")) return response();
      if (input.endsWith("/elections")) return Promise.resolve(new Response(JSON.stringify({ elections: [
        { year: 2026, round: 1, default: true }, { year: 2024, round: 2, default: false },
      ] })));
      if (input.endsWith("/states")) return Promise.resolve(new Response(JSON.stringify({ states: [] })));
      return Promise.resolve(new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", id: 23, properties: {code: "23", name: "Ceará", uf: "CE"}, geometry: {type: "Polygon", coordinates: [[[-40,-5],[-39,-5],[-39,-4],[-40,-5]]]}}] })));
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <HomePage />
      </QueryClientProvider>,
    );
  }

  it("o título nasce completo (sem texto digitando) e a busca é o instrumento central", () => {
    renderHome(() => new Promise<Response>(() => {}));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("O Brasil, em contexto.");
    expect(screen.getByRole("combobox", { name: "Buscar políticos, lugares, partidos e eleições" })).toBeTruthy();
    // enquanto a cobertura carrega: esqueleto, nunca números provisórios
    expect(document.querySelector("[aria-labelledby='coverage-heading']")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText(/eleitores aptos/)).toBeNull();
  });

  it("os números de cobertura chegam prontos (sem contagem) e vêm do que está importado", async () => {
    renderHome(() => Promise.resolve(new Response(JSON.stringify(OVERVIEW), { status: 200 })));
    expect(await screen.findByText("23.765")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ceará.*Governador/ }).getAttribute("href")).toBe("/eleicoes/2026/1/ce");
    expect(screen.queryByText("6.034")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2024 2º turno" }));
    expect(await screen.findByText("6.034")).toBeTruthy();
    expect(screen.queryByText("23.765")).toBeNull();
    expect(screen.getByText(/5 arquivos · download em 10\/10\/2026/)).toBeTruthy();
  });

  it("sem a cobertura, diz o que houve e oferece tentar de novo (o resto da página continua)", async () => {
    renderHome(() => Promise.resolve(new Response("{}", { status: 500 })));
    expect(await screen.findByText(/Não foi possível consultar a cobertura/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Da pessoa à trajetória." })).toBeTruthy();
  });
});

// ─── Perfil ─────────────────────────────────────────────────────────────────

const POLITICIAN: PoliticianDetail = {
  id: "pol-1",
  name: "Fulana de Tal",
  ballotName: "Fulana",
  tseId: "1",
  camaraId: null,
  senateId: null,
  state: "CE",
  partyAcronym: "XX",
  partyName: "Partido X",
  office: "PREFEITO",
  candidacyStatus: null,
  createdAt: "2026-01-01",
  sourceUpdatedAt: null,
  slug: "fulana",
};

function renderProfile(status: Parameters<typeof PoliticianProfile>[0]["status"], xrayStatus = 200) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const xray = { candidacies: [], insights: [], evolution: [], assetsEvolution: [], officialHistory: [], freshness: { stale: false, refreshedAt: null, note: "" }, definitions: {} };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(xray), { status: xrayStatus }))));
  return render(
    <QueryClientProvider client={client}>
      <PoliticianProfile politician={POLITICIAN} elections={[]} assets={[]} sources={[]} status={status} />
    </QueryClientProvider>,
  );
}

describe("perfil", () => {
  it("enquanto consulta, nunca afirma 'não encontrado'", () => {
    renderProfile({ elections: "pending", assets: "pending", sources: "pending" });
    expect(screen.queryByText("não encontrado")).toBeNull();
    expect(screen.getAllByText("consultando…")).toHaveLength(4);
  });

  it("falha de consulta é 'indisponível', não ausência", async () => {
    renderProfile({ elections: "ready", assets: "ready", sources: "ready" }, 500);
    expect(await screen.findAllByText("indisponível no momento")).toHaveLength(4);
    expect(screen.queryByText("sem votação importada")).toBeNull();
  });

  it("ausência confirmada diz o que falta (nunca zero) e mostra o cadastro anterior", async () => {
    renderProfile({ elections: "ready", assets: "ready", sources: "ready" });
    expect(await screen.findByText("sem votação importada")).toBeTruthy();
    expect(screen.getByText("não declarados")).toBeTruthy();
    expect(screen.getByTestId("profile-legacy").textContent).toContain("Prefeito");
    expect(screen.queryByText("0")).toBeNull();
  });

  it("abas: semântica WAI-ARIA, setas e Home/End", () => {
    renderProfile(undefined);
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    const eleicoes = within(tablist).getByRole("tab", { name: "Histórico eleitoral" });
    expect(eleicoes.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(eleicoes);
    fireEvent.keyDown(eleicoes, { key: "End" });
    expect(within(tablist).getByRole("tab", { name: "Score" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(within(tablist).getByRole("tab", { name: "Score" }).getAttribute("aria-selected")).toBe("true");
    // Só a aba selecionada entra na ordem de tabulação.
    expect(within(tablist).getAllByRole("tab").filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(within(tablist).getByRole("tab", { name: "Score" }).id);
  });

  it("deep link ?aba=eleicoes (ou ?aba=raio-x) abre direto no histórico eleitoral (sem passar pela visão geral)", () => {
    for (const aba of ["eleicoes", "raio-x"]) {
      window.history.replaceState(null, "", `/politicos/pol-1?aba=${aba}`);
      const { unmount } = renderProfile(undefined);
      expect(screen.getByRole("tab", { name: "Histórico eleitoral" }).getAttribute("aria-selected")).toBe("true");
      unmount();
    }
  });

  it("identidade compartilhada: avatar e nome levam os nomes de transição", () => {
    renderProfile(undefined);
    expect(screen.getByRole("heading", { level: 1 }).style.viewTransitionName).toBe("vt-name");
  });
});

// ─── Seção eleitoral ────────────────────────────────────────────────────────

describe("seção eleitoral em carregamento", () => {
  it("cabeçalho da seção pedida, rótulos fixos e nenhum número", () => {
    const route = parseElectionsPath("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381")!;
    render(
      <SectionResults
        route={route}
        municipalityName="Fortaleza/CE"
        data={sectionResults(12)}
        status="loading"
        isAggregatedInCadaster={false}
        principalNumber={381}
        voteType="todos"
        onOffice={vi.fn()}
        onVoteType={vi.fn()}
        closeHref="/x"
        onRetry={vi.fn()}
      />,
    );
    const section = screen.getByTestId("section-results");
    expect(within(section).getByRole("heading").textContent).toContain("381");
    expect(within(section).getByText("Aptos")).toBeTruthy();
    // Além da identidade da própria seção (Zona 094, Seção 381), nenhum número aparece.
    expect(section.textContent?.replace(/381|094/g, "")).not.toMatch(/\d/);
  });

  it("o nome do candidato é o elemento compartilhado com o perfil", () => {
    const route = parseElectionsPath("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381")!;
    render(
      <SectionResults
        route={route}
        municipalityName="Fortaleza/CE"
        data={sectionResults(381)}
        status="ready"
        isAggregatedInCadaster={false}
        principalNumber={381}
        voteType="todos"
        onOffice={vi.fn()}
        onVoteType={vi.fn()}
        closeHref="/x"
        onRetry={vi.fn()}
      />,
    );
    const link = screen.getByTestId("candidate-profile-link");
    expect(link.dataset.vt).toBe("name");
  });
});

// ─── Busca ──────────────────────────────────────────────────────────────────

describe("busca", () => {
  it("o traço de consulta só existe enquanto há consulta pendente; o clique em um card guarda a identidade", () => {
    vi.useFakeTimers();
    render(
      <NavigationProvider>
        <SearchInput />
      </NavigationProvider>,
    );
    const pending = screen.getByTestId("search-pending");
    expect(pending.dataset.pending).toBe("false");
    fireEvent.change(screen.getByLabelText("Buscar político"), { target: { value: "wagner" } });
    expect(pending.dataset.pending).toBe("true");
    act(() => vi.advanceTimersByTime(300));
    expect(pending.dataset.pending).toBe("false");
    expect(nav.push).toHaveBeenCalledWith("/politicos?q=wagner&page=1", { scroll: undefined });
    vi.useRealTimers();
    expect(identityHint("ninguem")).toBeNull();
  });
});

// ─── Câmara ─────────────────────────────────────────────────────────────────

describe("aba Câmara", () => {
  function renderCamara(response: () => Promise<Response>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(response));
    render(
      <QueryClientProvider client={client}>
        <CamaraTab politicianId="pol-9" camaraId="220593" />
      </QueryClientProvider>,
    );
  }

  it("carregando: estrutura sem nenhum dado inventado; depois o mandato oficial", async () => {
    let resolve!: (r: Response) => void;
    renderCamara(() => new Promise<Response>((r) => (resolve = r)));
    const busy = document.querySelector("[aria-busy='true']")!;
    expect(busy.textContent).toBe("Carregando dados da Câmara");
    expect(busy.querySelector("output")).toBeTruthy();
    resolve(
      new Response(
        JSON.stringify([
          { id: "m1", house: "CAMARA", legislature: 57, title: "DEPUTADO FEDERAL", state: "MT", partyAcronym: "PL", startDate: "2023-02-01", endDate: "2027-01-31", externalId: "220593", externalUrl: null },
        ]),
        { status: 200 },
      ),
    );
    expect(await screen.findByText("DEPUTADO FEDERAL")).toBeTruthy();
    expect(screen.getByText(/57ª Legislatura/)).toBeTruthy();
  });

  it("falha da API não vira 'nenhum mandato'", async () => {
    renderCamara(() => Promise.resolve(new Response("boom", { status: 500 })));
    expect(await screen.findByText("Erro ao carregar dados da Câmara.")).toBeTruthy();
    expect(screen.queryByText(/Nenhum mandato/)).toBeNull();
  });
});

// ─── Drawer móvel ───────────────────────────────────────────────────────────

describe("navegação móvel direta", () => {
  it("oferece quatro destinos, marca a página atual e mantém o link de pular conteúdo", () => {
    nav.pathname = "/eleicoes";
    render(
      <NavigationProvider>
        <AppShell>
          <p>conteúdo</p>
        </AppShell>
      </NavigationProvider>,
    );
    const mobile = screen.getByRole("navigation", { name: "Navegação principal no celular" });
    expect(within(mobile).getAllByRole("link")).toHaveLength(4);
    expect(within(mobile).getByRole("link", { name: "Eleições" }).getAttribute("aria-current")).toBe("page");
    expect(within(mobile).getByRole("link", { name: "Comparar" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" }).getAttribute("href")).toBe("#conteudo");
  });
});
