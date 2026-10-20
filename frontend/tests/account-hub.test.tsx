import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountHub } from "@/components/account/AccountHub";
import { AlertsSection } from "@/components/account/AlertsSection";
import { NotificationsSection } from "@/components/account/NotificationsSection";
import { PlansPage } from "@/components/account/PlansPage";
import { ProfileSection } from "@/components/account/ProfileSection";
import { SaveCurrentPage } from "@/components/account/SaveCurrentPage";
import { SavedSection } from "@/components/account/SavedSection";
import { normalizeAccount, type AccountMe } from "@/lib/account";
import { compareMax, CompareLimitError, MAX_COMPARE, toggleSelection, xrayApi } from "@/lib/elections/xray";
import { formatMonthlyPrice, type PlansCatalog } from "@/lib/plans";
import { nav } from "./support/next";

const ME: AccountMe = {
  id: "u1",
  email: "ana@example.test",
  displayName: "Ana",
  avatarUrl: null,
  csrfToken: "csrf-1",
  sessionExpiresAt: "2026-11-19T12:00:00Z",
  role: "user",
  plan: "FREE",
  planSource: "default",
  capabilities: { "account.saved_folders": false },
  limits: { "limit.favorites": 10, "limit.watchlist": 5, "limit.alerts": 3, "limit.compare_candidacies": 5 },
  subscription: null,
  profile: { fullName: null, stateCode: null, municipalityIbgeCode: null, municipalityName: null, usageType: null, avatarHidden: false },
  usage: { favorites: 7, watchlist: 5, alerts: 0, unreadNotifications: 2 },
};

const PRO: AccountMe = {
  ...ME,
  plan: "PROFESSIONAL",
  planSource: "subscription",
  capabilities: { "account.saved_folders": true },
  limits: { "limit.favorites": 1000, "limit.watchlist": 500, "limit.alerts": 200, "limit.compare_candidacies": 10 },
};

const PLANS: PlansCatalog = {
  currency: "BRL",
  interval: "month",
  billing: { available: false, message: "Pagamento online ainda não disponível." },
  baseline: ["Consulta a todos os dados públicos carregados", "Fontes, metodologia, proveniência e data de atualização"],
  capabilities: [
    { key: "limit.favorites", kind: "limit", group: "Conta", label: "Favoritos", description: "Páginas salvas." },
    { key: "account.saved_folders", kind: "feature", group: "Conta", label: "Pastas", description: "Organizar em pastas." },
    { key: "limit.compare_candidacies", kind: "limit", group: "Análise", label: "Candidaturas por comparação", description: "Quantas." },
  ],
  plans: [
    { code: "FREE", rank: 0, name: "Gratuito", monthlyPriceCents: 0, recommended: false, summary: "Tudo o que é público.", audience: "Para qualquer cidadão.", features: { "account.saved_folders": false }, limits: { "limit.favorites": 10, "limit.compare_candidacies": 5 } },
    { code: "ADVANCED", rank: 1, name: "Avançado", monthlyPriceCents: 2490, recommended: true, summary: "Para acompanhar.", audience: "Eleitores atentos.", features: { "account.saved_folders": false }, limits: { "limit.favorites": 200, "limit.compare_candidacies": 5 } },
    { code: "PROFESSIONAL", rank: 2, name: "Profissional", monthlyPriceCents: 6990, recommended: false, summary: "Uso profissional.", audience: "Jornalistas.", features: { "account.saved_folders": true }, limits: { "limit.favorites": 1000, "limit.compare_candidacies": 10 } },
  ],
};

type Reply = { status: number; body?: unknown };
type Handler = (url: string, init?: RequestInit) => Reply;

/** API simulada por rota (primeiro padrão que casa); o resto é 404. */
function stubApi(routes: Array<[string, Handler]>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes.find(([pattern]) => String(url).includes(pattern));
    const reply = route ? route[1](String(url), init) : { status: 404, body: { error: "not found" } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body?: unknown): Handler => () => ({ status: body === undefined ? 204 : 200, body });
const calls = (fn: ReturnType<typeof stubApi>, pattern: string, method = "GET") =>
  fn.mock.calls.filter(([url, init]) => String(url).includes(pattern) && (init?.method ?? "GET") === method);

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  nav.pathname = "/";
  nav.search = "";
  nav.replace.mockReset();
});

describe("hub /conta", () => {
  it("sem sessão volta ao login guardando a seção pedida", async () => {
    nav.pathname = "/conta/alertas";
    stubApi([["/account/session", () => ({ status: 200, body: { authenticated: false } })]]);
    renderWithClient(<AccountHub><p>conteúdo</p></AccountHub>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/entrar?returnTo=%2Fconta%2Falertas"));
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("cabeçalho com o plano decidido pela API e a seção atual marcada", async () => {
    nav.pathname = "/conta/notificacoes";
    stubApi([["/account/session", ok({ authenticated: true, ...ME })]]);
    renderWithClient(<AccountHub><p>conteúdo</p></AccountHub>);
    expect(await screen.findByRole("heading", { name: "Ana" })).toBeTruthy();
    expect(screen.getByText("Gratuito").closest("p")?.textContent).toContain("Plano Gratuito");
    const nav_ = screen.getByRole("navigation", { name: "Seções da conta" });
    const current = within(nav_).getByRole("link", { current: "page" });
    expect(current.textContent).toContain("Notificações");
    expect(current.textContent).toContain("2 não lidas");
    expect(within(nav_).getAllByRole("link")).toHaveLength(8);
    expect(screen.getByText("conteúdo")).toBeTruthy();
  });

  it("falha da API vira erro com nova tentativa, nunca tela vazia", async () => {
    stubApi([["/account/session", () => ({ status: 500, body: { error: "boom" } })]]);
    renderWithClient(<AccountHub><p>conteúdo</p></AccountHub>);
    expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("Não foi possível carregar sua conta");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });

  it("resposta de uma API anterior (sem plano) vira conta Gratuita sem recursos", () => {
    const legacy = normalizeAccount({ id: "u1", email: "a@b.c", csrfToken: "t" });
    expect(legacy.plan).toBe("FREE");
    expect(legacy.limits).toEqual({});
    expect(legacy.usage.favorites).toBe(0);
  });
});

describe("perfil", () => {
  const PROFILE = { email: ME.email, displayName: "Ana", fullName: null, providerAvatarUrl: null, avatarHidden: false, stateCode: null, municipalityIbgeCode: null, municipalityName: null, usageType: null, customizedAt: null };

  it("UF → município do catálogo IBGE, salva com o CSRF da sessão e confirma", async () => {
    const fn = stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/territories/states/AC/municipalities", ok([{ ibgeCode: "1200401", name: "Rio Branco", slug: "rio-branco", tseCode: "01392", stateCode: "AC" }])],
      ["/account/profile", (_url, init) => (init?.method === "POST"
        ? { status: 200, body: { ...PROFILE, stateCode: "AC", municipalityIbgeCode: "1200401", municipalityName: "Rio Branco", usageType: "jornalista" } }
        : { status: 200, body: PROFILE })],
    ]);
    renderWithClient(<ProfileSection />);
    fireEvent.change(await screen.findByLabelText("UF"), { target: { value: "AC" } });
    const municipality = screen.getByLabelText("Município");
    await waitFor(() => expect(within(municipality).getByRole("option", { name: "Rio Branco" })).toBeTruthy());
    fireEvent.change(municipality, { target: { value: "1200401" } });
    fireEvent.change(screen.getByLabelText("Como você usa o REPBrasil"), { target: { value: "jornalista" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    expect((await screen.findByRole("status")).textContent).toBe("Perfil salvo.");
    const [, init] = calls(fn, "/account/profile", "POST")[0];
    expect((init?.headers as Record<string, string>)["X-RepBrasil-CSRF"]).toBe("csrf-1");
    expect(JSON.parse(String(init?.body))).toMatchObject({ stateCode: "AC", municipalityIbgeCode: "1200401", usageType: "jornalista" });
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/Não pedimos CPF, partido, candidato, ideologia, religião nem intenção de voto/)).toBeTruthy();
  });

  it("validação da API aparece como alerta, com a mensagem dela", async () => {
    stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/account/profile", (_url, init) => (init?.method === "POST" ? { status: 400, body: { error: "Nome: no máximo 120 caracteres." } } : { status: 200, body: PROFILE })],
    ]);
    renderWithClient(<ProfileSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Salvar perfil" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Nome: no máximo 120 caracteres.");
  });
});

describe("/planos", () => {
  it("preço mensal de cada plano, Avançado recomendado por hierarquia e cobrança indisponível sem botão falso", async () => {
    stubApi([["/api/v1/plans", ok(PLANS)], ["/account/session", ok({ authenticated: true, ...ME })]]);
    renderWithClient(<PlansPage />);
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const advanced = headers.find((h) => h.textContent?.includes("Avançado"))!;
    expect(advanced.textContent).toContain("Recomendado");
    expect(advanced.textContent).toMatch(/R\$\s24,90\s*\/ mês/);
    expect(headers.find((h) => h.textContent?.includes("Profissional"))!.textContent).toMatch(/R\$\s69,90/);
    expect(within(table).getAllByText("Recomendado")).toHaveLength(1);
    expect(headers.find((h) => h.textContent?.includes("Gratuito"))!.textContent).toContain("Seu plano");
    expect(screen.getByRole("note").textContent).toContain("Pagamento online ainda não disponível.");
    expect(screen.queryByRole("button", { name: /assinar/i })).toBeNull();
    expect(screen.getByText("Consulta a todos os dados públicos carregados")).toBeTruthy();
  });

  it("formata o preço em reais; o gratuito não ganha centavos", () => {
    expect(formatMonthlyPrice(2490)).toMatch(/^R\$\s24,90$/);
    expect(formatMonthlyPrice(0)).toBe("R$ 0");
  });
});

describe("favoritos e watchlist", () => {
  const ITEM = { id: "s1", collection: "favorite", resourceType: "ranking", resourceKey: "/rankings?ano=2024", label: "Rankings 2024", href: "/rankings?ano=2024", metadata: {}, createdAt: "2026-10-10T12:00:00Z", folder: null };

  it("Gratuito: uso frente ao limite, sem pastas, e remover usa o CSRF", async () => {
    const fn = stubApi([["/account/session", ok({ authenticated: true, ...ME })], ["/account/saved", (_u, init) => (init?.method === "DELETE" ? { status: 204 } : { status: 200, body: [ITEM] })]]);
    renderWithClient(<SavedSection collection="favorite" />);
    expect(await screen.findByText("Rankings 2024")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Favoritos" }).getAttribute("aria-valuetext")).toBe("7 de 10");
    expect(screen.getByText(/Organizar em pastas faz parte do plano Profissional/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pasta" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover Rankings 2024" }));
    await waitFor(() => expect(calls(fn, "/account/saved?", "DELETE")).toHaveLength(1));
    expect((calls(fn, "/account/saved?", "DELETE")[0][1]?.headers as Record<string, string>)["X-RepBrasil-CSRF"]).toBe("csrf-1");
  });

  it("watchlist no limite avisa e oferece os planos", async () => {
    stubApi([["/account/session", ok({ authenticated: true, ...ME })], ["/account/saved", ok([])]]);
    renderWithClient(<SavedSection collection="watchlist" />);
    expect((await screen.findByText(/Limite do plano atingido/)).textContent).toContain("Ver planos");
  });

  it("Profissional: move o item para uma pasta", async () => {
    const fn = stubApi([
      ["/account/session", ok({ authenticated: true, ...PRO })],
      ["/account/saved/folder", ok({ ...ITEM, folder: "Eleições 2026" })],
      ["/account/saved", ok([ITEM])],
    ]);
    renderWithClient(<SavedSection collection="favorite" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pasta" }));
    fireEvent.change(screen.getByLabelText("Nome da pasta (vazio tira da pasta)"), { target: { value: "Eleições 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fn, "/account/saved/folder", "POST")).toHaveLength(1));
    expect(JSON.parse(String(calls(fn, "/account/saved/folder", "POST")[0][1]?.body))).toMatchObject({ resourceKey: "/rankings?ano=2024", folder: "Eleições 2026" });
  });
});

describe("alertas", () => {
  const KINDS = [
    { resourceType: "state", eventKind: "amendments_update", label: "Emendas parlamentares da UF", description: "Quando uma nova versão da base oficial de emendas da UF é carregada.", keyFormat: "UF" },
    { resourceType: "indicator", eventKind: "new_edition", label: "Nova edição de indicador", description: "Quando…", keyFormat: "código" },
  ];

  it("cria o alerta do catálogo escolhido, entregue na conta", async () => {
    const fn = stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/account/alert-kinds", ok(KINDS)],
      ["/account/alerts", (_u, init) => (init?.method === "POST" ? { status: 200, body: { id: "a1" } } : { status: 200, body: [] })],
      ["/data/indicators", ok([])],
    ]);
    renderWithClient(<AlertsSection />);
    fireEvent.change(await screen.findByLabelText("UF"), { target: { value: "CE" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar alerta" }));
    await waitFor(() => expect(calls(fn, "/account/alerts", "POST")).toHaveLength(1));
    expect(JSON.parse(String(calls(fn, "/account/alerts", "POST")[0][1]?.body))).toEqual({
      resourceType: "state", resourceKey: "CE", eventKind: "amendments_update", enabled: true, delivery: "in_app",
    });
    expect((await screen.findByRole("status")).textContent).toContain("Alerta criado");
    expect(screen.getByText(/Alertas por e-mail ainda não existem/)).toBeTruthy();
  });

  it("limite do plano: a recusa da API aparece com o caminho para os planos", async () => {
    stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/account/alert-kinds", ok(KINDS)],
      ["/account/alerts", (_u, init) => (init?.method === "POST"
        ? { status: 403, body: { error: "plan_limit_reached", limit: "limit.alerts", max: 3, requiredPlan: "ADVANCED", message: "Você atingiu o limite de 3 em Alertas. O plano Avançado permite 50." } }
        : { status: 200, body: [] })],
      ["/data/indicators", ok([])],
    ]);
    renderWithClient(<AlertsSection />);
    fireEvent.change(await screen.findByLabelText("UF"), { target: { value: "CE" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar alerta" }));
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("O plano Avançado permite 50.");
    expect(within(refusal).getByRole("link", { name: "Ver planos" }).getAttribute("href")).toBe("/planos");
  });
});

describe("notificações", () => {
  it("não lida marcada por texto; marcar todas usa o CSRF", async () => {
    const fn = stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/account/notifications/read-all", ok()],
      ["/account/notifications", ok([
        { id: "n1", eventKey: "e1", resourceType: "indicator", resourceKey: "ibge.population", title: "Nova edição oficial: População (2022)", body: "IBGE", href: "/dados?x=ibge.population", payload: { sourceUrl: "https://ibge.gov.br/x" }, createdAt: "2026-10-20T12:00:00Z", readAt: null },
      ])],
    ]);
    renderWithClient(<NotificationsSection />);
    const title = await screen.findByRole("link", { name: "Nova edição oficial: População (2022)" });
    expect(title.closest("p")?.textContent).toContain("Nova");
    expect(screen.getByRole("link", { name: "fonte oficial" }).getAttribute("href")).toBe("https://ibge.gov.br/x");
    fireEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(calls(fn, "/account/notifications/read-all", "POST")).toHaveLength(1));
  });
});

describe("salvar a página atual", () => {
  it("limite do plano atingido: explica e aponta os planos", async () => {
    nav.pathname = "/rankings";
    stubApi([
      ["/account/session", ok({ authenticated: true, ...ME })],
      ["/account/saved", (_u, init) => (init?.method === "POST"
        ? { status: 403, body: { error: "plan_limit_reached", limit: "limit.favorites", max: 10, requiredPlan: "ADVANCED", message: "Você atingiu o limite de 10 em Favoritos." } }
        : { status: 200, body: [] })],
    ]);
    renderWithClient(<SaveCurrentPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Favorito/ }));
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("Você atingiu o limite de 10 em Favoritos.");
    expect(within(refusal).getByRole("link", { name: "Ver planos" })).toBeTruthy();
  });
});

describe("comparação ampliada", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);

  it("limite efetivo nunca abaixo do público nem acima do teto técnico", () => {
    expect([compareMax(undefined), compareMax(3), compareMax(10), compareMax(99)]).toEqual([MAX_COMPARE, MAX_COMPARE, 10, 10]);
    expect(toggleSelection(ids(5), "x", 10)).toEqual({ ids: [...ids(5), "x"], rejected: false });
    expect(toggleSelection(ids(5), "x").rejected).toBe(true);
  });

  it("até 5 pelo caminho público; acima disso pelo caminho autenticado, com credenciais", async () => {
    const fn = stubApi([["/elections/compare", ok({ candidacies: [] })]]);
    await xrayApi.compare(ids(5), { uf: "CE", level: "state" }, 10);
    await xrayApi.compare(ids(7), { uf: "CE", level: "state" }, 10);
    const [publicCall, extendedCall] = fn.mock.calls;
    expect(String(publicCall[0])).toContain("/elections/compare?");
    expect(publicCall[1]).toBeUndefined();
    expect(String(extendedCall[0])).toContain("/elections/compare/extended?");
    expect(extendedCall[1]).toEqual({ credentials: "include" });
    await expect(xrayApi.compare(ids(11), { uf: "CE", level: "state" }, 10)).rejects.toBeInstanceOf(CompareLimitError);
  });
});
