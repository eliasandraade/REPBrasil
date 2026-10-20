import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManifestoPage from "@/app/manifesto/page";
import { AppShell } from "@/components/layout/AppShell";
import { MetadataTab } from "@/components/politicians/tabs/MetadataTab";
import type { PoliticianDetail } from "@/lib/types";
import { NavigationProvider } from "@/motion/navigation";
import { nav } from "./support/next";

const SESSION = {
  authenticated: true,
  id: "u1",
  email: "ana@example.test",
  displayName: "Ana Souza",
  avatarUrl: null,
  csrfToken: "c",
  sessionExpiresAt: "2026-11-19T12:00:00Z",
  role: "user",
  plan: "ADVANCED",
  planSource: "subscription",
  capabilities: {},
  limits: {},
  subscription: null,
  profile: null,
  usage: { favorites: 0, watchlist: 0, alerts: 0, unreadNotifications: 0 },
};

function renderShell(session: unknown, children: ReactNode = <p>conteúdo</p>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NavigationProvider>
        <AppShell>{children}</AppShell>
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

/** A barra lateral fixa (desktop); a gaveta móvel tem a mesma navegação. */
const desktopNav = () => document.querySelector("aside")!;

afterEach(() => {
  vi.unstubAllGlobals();
  nav.pathname = "/";
  nav.search = "";
});

describe("navegação autenticada", () => {
  it("sem sessão: Entrar volta para a mesma página, com o recorte", async () => {
    nav.pathname = "/dados";
    nav.search = "uf=CE";
    renderShell({ authenticated: false });
    const link = await within(desktopNav()).findByRole("link", { name: "Entrar" });
    expect(link.getAttribute("href")).toBe("/entrar?returnTo=%2Fdados%3Fuf%3DCE");
  });

  it("com sessão: nome e plano levam à conta; Administração só para Super Admin", async () => {
    renderShell(SESSION);
    const account = await within(desktopNav()).findByRole("link", { name: /Ana Souza/ });
    expect(account.getAttribute("href")).toBe("/conta");
    expect(account.textContent).toContain("Plano Avançado");
    expect(within(desktopNav()).queryByRole("link", { name: "Administração" })).toBeNull();
  });

  it("Super Admin vê o atalho da Administração", async () => {
    renderShell({ ...SESSION, role: "superadmin", plan: "PROFESSIONAL" });
    const admin = await within(desktopNav()).findByRole("link", { name: "Administração" });
    expect(admin.getAttribute("href")).toBe("/admin");
  });

  it("Parlamento está na navegação principal; Glossário e Suporte com rótulos próprios", async () => {
    renderShell({ authenticated: false });
    const main = within(desktopNav()).getByRole("navigation", { name: "Navegação principal" });
    expect(within(main).getByRole("link", { name: "Parlamento" }).getAttribute("href")).toBe("/parlamento");
    expect(within(main).getByRole("link", { name: "Glossário" })).toBeTruthy();
    expect(within(main).getByRole("link", { name: "Suporte" })).toBeTruthy();
  });
});

describe("acessibilidade do shell", () => {
  it("o primeiro elemento focável pula a navegação e leva ao conteúdo", () => {
    renderShell({ authenticated: false });
    const skip = screen.getByRole("link", { name: "Pular para o conteúdo" });
    expect(skip.getAttribute("href")).toBe("#conteudo");
    const target = document.getElementById("conteudo")!;
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(target.textContent).toContain("conteúdo");
  });

  it("gaveta aberta é um diálogo modal: o conteúdo atrás fica inerte e há botão de fechar dentro dela", async () => {
    renderShell({ authenticated: false });
    const drawer = document.getElementById("mobile-nav")!;
    expect(drawer.getAttribute("role")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById("conteudo")!.closest("[inert]")).not.toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "Fechar menu" }));
    await waitFor(() => expect(drawer.hasAttribute("inert")).toBe(true));
    expect(document.getElementById("conteudo")!.closest("[inert]")).toBeNull();
  });
});

describe("honestidade e Manifesto", () => {
  it("o Manifesto traz a Sustentabilidade: dado público essencial fora de paywall", () => {
    render(<ManifestoPage />);
    expect(screen.getByRole("heading", { name: "Sustentabilidade" })).toBeTruthy();
    expect(screen.getByTestId("manifesto-sustentabilidade").textContent).toContain(
      "não devem ser artificialmente escondidos atrás de um paywall",
    );
  });

  it("fontes: falha não vira ausência, e a lista se apresenta como do sistema", () => {
    const politician = { createdAt: "2026-01-01T00:00:00Z", sourceUpdatedAt: null } as unknown as PoliticianDetail;
    const retry = vi.fn();
    const { rerender } = render(<MetadataTab politician={politician} sources={[]} sourcesState="error" onRetrySources={retry} />);
    expect(screen.getByText("Não foi possível carregar as fontes.")).toBeTruthy();
    expect(screen.queryByText(/Nenhuma fonte/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/i }));
    expect(retry).toHaveBeenCalled();
    rerender(<MetadataTab politician={politician} sources={[]} sourcesState="ready" />);
    expect(screen.getByText("Fontes do sistema")).toBeTruthy();
    expect(screen.getByText("Nenhuma fonte de dados cadastrada no sistema até agora.")).toBeTruthy();
  });
});
