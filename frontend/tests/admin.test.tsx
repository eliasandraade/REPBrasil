import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SuportePage from "@/app/suporte/page";
import { accessLabel, AdminApiCatalog, normalizeRoute } from "@/components/admin/AdminApiCatalog";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminUserDetailView } from "@/components/admin/AdminUserDetailView";
import type { AccountMe } from "@/lib/account";
import type { AdminUserDetail } from "@/lib/admin";
import { nav } from "./support/next";

type Reply = { status: number; body?: unknown };
type Handler = (url: string, init?: RequestInit) => Reply;

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

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const ADMIN: AccountMe = {
  id: "admin-1", email: "admin@example.test", displayName: "Admin", avatarUrl: null, csrfToken: "csrf-admin", sessionExpiresAt: "2026-11-19T12:00:00Z",
  role: "superadmin", plan: "PROFESSIONAL", planSource: "role", capabilities: {}, limits: {}, subscription: null,
  profile: { fullName: null, stateCode: null, municipalityIbgeCode: null, municipalityName: null, usageType: null, avatarHidden: false },
  usage: { favorites: 0, watchlist: 0, alerts: 0, unreadNotifications: 0 },
};

const DETAIL: AdminUserDetail = {
  id: "user-1", email: "pessoa@example.test", displayName: "Pessoa", fullName: null, stateCode: "CE", municipalityName: "Fortaleza", usageType: "jornalista",
  status: "active", disabledReason: null, disabledAt: null, createdAt: "2026-10-01T12:00:00Z", lastSeenAt: "2026-10-20T12:00:00Z", activeSessions: 1,
  providers: ["magic_link"], configuredSuperadmin: false,
  access: { role: "user", plan: "FREE", planSource: "default", features: {}, limits: {} },
  entitlements: [], subscriptions: [], usage: { favorites: 2, watchlist: 0, alerts: 1, unreadNotifications: 0 }, audit: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  nav.pathname = "/";
  nav.replace.mockReset();
});

describe("guarda do /admin (decisão do servidor)", () => {
  it("sem sessão volta ao login guardando a seção", async () => {
    nav.pathname = "/admin/auditoria";
    stubApi([["/admin/me", () => ({ status: 401 })]]);
    renderWithClient(<AdminShell><p>segredo administrativo</p></AdminShell>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/entrar?returnTo=%2Fadmin%2Fauditoria"));
    expect(screen.queryByText("segredo administrativo")).toBeNull();
  });

  it("conta comum vê “Acesso restrito” e nenhum conteúdo administrativo", async () => {
    stubApi([["/admin/me", () => ({ status: 403, body: { error: "forbidden" } })]]);
    renderWithClient(<AdminShell><p>segredo administrativo</p></AdminShell>);
    expect(await screen.findByRole("heading", { name: "Acesso restrito" })).toBeTruthy();
    expect(screen.queryByText("segredo administrativo")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Seções da administração" })).toBeNull();
  });

  it("Super Admin vê as seções e a atual marcada", async () => {
    nav.pathname = "/admin/contas/user-1";
    stubApi([["/admin/me", ok({ id: "admin-1", email: "admin@example.test", role: "superadmin" })]]);
    renderWithClient(<AdminShell><p>conteúdo</p></AdminShell>);
    const sections = await screen.findByRole("navigation", { name: "Seções da administração" });
    expect(within(sections).getByRole("link", { current: "page" }).textContent).toBe("Contas");
    expect(screen.getByText("conteúdo")).toBeTruthy();
  });
});

describe("ações do Super Admin", () => {
  it("suspender pede confirmação, envia o motivo com o CSRF e mostra o resultado", async () => {
    const fn = stubApi([
      ["/account/session", ok({ authenticated: true, ...ADMIN })],
      ["/api/v1/plans", ok({ capabilities: [], plans: [], baseline: [], billing: { available: false, message: null }, currency: "BRL", interval: "month" })],
      ["/admin/users/user-1/suspend", ok({ ...DETAIL, status: "suspended", disabledReason: "Robô" })],
      ["/admin/users/user-1", ok(DETAIL)],
    ]);
    renderWithClient(<AdminUserDetailView id="user-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspender" }));
    const dialog = await screen.findByRole("dialog", { name: "Suspender esta conta?" });
    fireEvent.change(within(dialog).getByLabelText("Motivo (registrado na auditoria)"), { target: { value: "Robô" } });
    expect(fn.mock.calls.some(([url]) => String(url).includes("/suspend"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspender" }));
    expect((await screen.findByRole("status")).textContent).toBe("Alteração aplicada e registrada na auditoria.");
    const [, init] = fn.mock.calls.find(([url]) => String(url).includes("/suspend"))!;
    expect((init?.headers as Record<string, string>)["X-RepBrasil-CSRF"]).toBe("csrf-admin");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "Robô" });
    expect(screen.getByText("Motivo: Robô")).toBeTruthy();
  });

  it("recusa do servidor (último Super Admin) aparece como alerta, sem mudar a tela", async () => {
    stubApi([
      ["/account/session", ok({ authenticated: true, ...ADMIN })],
      ["/api/v1/plans", ok({ capabilities: [], plans: [], baseline: [], billing: { available: false, message: null }, currency: "BRL", interval: "month" })],
      ["/admin/users/user-1/role", () => ({ status: 409, body: { error: "last_superadmin", message: "Esta é a última conta de Super Admin ativa; conceda o papel a outra conta antes." } })],
      ["/admin/users/user-1", ok({ ...DETAIL, access: { ...DETAIL.access, role: "superadmin" } })],
    ]);
    renderWithClient(<AdminUserDetailView id="user-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remover Super Admin" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("última conta de Super Admin");
  });
});

describe("catálogo da API no admin", () => {
  it("rota-modelo das métricas casa com o caminho do OpenAPI", () => {
    expect(normalizeRoute("api/v1/elections/{year:int}/{round:int}/states/{uf}")).toBe("/api/v1/elections/{year}/{round}/states/{uf}");
    expect(normalizeRoute("api/v1/admin/users/{id:guid}/entitlements/{key}")).toBe("/api/v1/admin/users/{id}/entitlements/{key}");
  });

  it("agrupa por área, mostra a regra de acesso do servidor e as métricas; só GET público executa", async () => {
    stubApi([["/admin/openapi", ok({
      generatedAt: "2026-10-20T12:00:00Z",
      metricsSince: "2026-10-20T10:00:00Z",
      metrics: [{ method: "GET", route: "api/v1/plans", calls: 12, clientErrors: 0, serverErrors: 0, p95Ms: 8, lastCallAt: null }],
      document: {
        paths: {
          "/api/v1/plans": { get: { tags: ["Plans"], summary: "Catálogo de planos", "x-repbrasil-access": { kind: "public", label: "Público", csrf: false } } },
          "/api/v1/account/saved/folder": { post: { tags: ["Account"], "x-repbrasil-access": { kind: "capability", label: "x", csrf: true, capability: "account.saved_folders", requiredPlan: "PROFESSIONAL" } } },
          "/api/v1/admin/users": { get: { tags: ["Administração"], "x-repbrasil-access": { kind: "superadmin", label: "Super Admin", csrf: false } } },
        },
      },
    })]]);
    renderWithClient(<AdminApiCatalog />);
    expect(await screen.findByRole("heading", { name: "Administração" })).toBeTruthy();
    expect(screen.getByText("3 rotas")).toBeTruthy();
    expect(screen.getByText("12 chamadas · 0 5xx · p95 8 ms")).toBeTruthy();
    expect(screen.getByText("Plano Profissional + CSRF")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Executar GET público" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Filtrar rotas"), { target: { value: "folder" } });
    expect(screen.getByText("1 rota")).toBeTruthy();
  });

  it("rótulos de acesso cobrem todas as regras", () => {
    expect(accessLabel({ kind: "session", label: "", csrf: true })).toBe("Sessão + CSRF");
    expect(accessLabel({ kind: "header", label: "", csrf: false, header: "X-Api-Key" })).toBe("Cabeçalho X-Api-Key");
    expect(accessLabel(null)).toBe("Não informado");
  });
});

describe("/suporte envia de verdade", () => {
  async function fill() {
    fireEvent.change(screen.getByLabelText("Tipo de pedido"), { target: { value: "contestacao" } });
    fireEvent.change(screen.getByLabelText("E-mail para a resposta"), { target: { value: "pessoa@example.test" } });
    fireEvent.change(screen.getByLabelText("Fonte oficial ou documento (recomendado)"), { target: { value: "https://dadosabertos.tse.jus.br/" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "O total de votos da seção 33 diverge do boletim de urna." } });
  }

  it("grava o pedido e mostra o protocolo devolvido pela API", async () => {
    const fn = stubApi([["/support/requests", () => ({ status: 202, body: { status: "received", id: "1a2b3c4d-0000-0000-0000-000000000000" } })]]);
    render(<SuportePage />);
    expect(screen.queryByText(/Triagem em 24h/)).toBeNull();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pedido registrado · protocolo 1a2b3c4d");
    expect(JSON.parse(String(fn.mock.calls[0][1]?.body))).toMatchObject({ category: "contestacao", sourceReference: "https://dadosabertos.tse.jus.br/", name: null });
  });

  it("limite por origem (429) vira mensagem própria; nada de “recebido” falso", async () => {
    stubApi([["/support/requests", () => ({ status: 429 })]]);
    render(<SuportePage />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Muitos pedidos");
    expect(screen.queryByText(/Pedido registrado/)).toBeNull();
  });

  it("FAQ acessível: botão com aria-expanded controla a resposta", () => {
    render(<SuportePage />);
    const question = screen.getByRole("button", { name: "Que dados da minha conta vocês guardam?" });
    expect(question.getAttribute("aria-expanded")).toBe("false");
    const answer = document.getElementById(question.getAttribute("aria-controls")!)!;
    expect(answer.hidden).toBe(true);
    fireEvent.click(question);
    expect(question.getAttribute("aria-expanded")).toBe("true");
    expect(answer.hidden).toBe(false);
    expect(answer.textContent).toContain("Nunca pedimos CPF");
  });
});
