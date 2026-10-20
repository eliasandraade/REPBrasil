import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/entrar/page";
import { MAGIC_LINK_TIMEOUT_MS } from "@/lib/account";
import { reportCsv, type ExportReport } from "@/lib/export/report";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function openSignIn(search: string) {
  window.history.replaceState({}, "", `/entrar${search}`);
  render(<SignInPage />);
}

describe("/entrar explica por que o acesso falhou", () => {
  it.each([
    ["link-invalido", "aberto em um navegador diferente"],
    ["estado-invalido", "Não foi possível confirmar o login com o Google neste navegador"],
    ["google-cancelado", "O login com o Google foi cancelado"],
    ["google-falhou", "e-mail verificado"],
    ["google-indisponivel", "O login com o Google está indisponível"],
  ])("erro %s", async (code, message) => {
    openSignIn(`?erro=${code}`);
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("código desconhecido não inventa mensagem", () => {
    openSignIn("?erro=qualquer-coisa");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aceita só caminho local como destino depois do login", async () => {
    openSignIn("?returnTo=/dados%3Fx%3D1");
    const google = await screen.findByRole("link", { name: "Continuar com Google" });
    expect(google.getAttribute("href")).toContain(`returnTo=${encodeURIComponent("/dados?x=1")}`);
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example"])("ignora destino %s", (target) => {
    openSignIn(`?returnTo=${encodeURIComponent(target)}`);
    const google = screen.getByRole("link", { name: "Continuar com Google" });
    expect(google.getAttribute("href")).toContain(`returnTo=${encodeURIComponent("/conta")}`);
  });
});

describe("/entrar sempre sai de “Enviando…” ao pedir o link por e-mail", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function submitEmail() {
    openSignIn("");
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "pessoa@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso" }));
    expect(screen.getByRole("button", { name: "Enviando…" }).hasAttribute("disabled")).toBe(true);
  }

  const sendButtonEnabled = () =>
    expect(screen.getByRole("button", { name: "Receber link de acesso" }).hasAttribute("disabled")).toBe(false);

  it("confirma o pedido aceito pela API", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: "accepted" }), { status: 202, headers: { "Content-Type": "application/json" } }))));
    submitEmail();
    expect((await screen.findByRole("status")).textContent).toContain("o link chegará em instantes");
    sendButtonEnabled();
  });

  it("explica a indisponibilidade quando o provedor falha (503)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: "O login por e-mail está temporariamente indisponível." }), { status: 503 }))));
    submitEmail();
    expect((await screen.findByRole("alert")).textContent).toContain("O login por e-mail está indisponível agora");
    sendButtonEnabled();
  });

  it("desiste no prazo quando a API não responde", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Pedido abortado", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    submitEmail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAGIC_LINK_TIMEOUT_MS);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("O login por e-mail está indisponível agora");
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    sendButtonEnabled();
  });
});

const REPORT: ExportReport = {
  filename: "csv-seguro",
  title: "Comparação",
  headers: ["Entidade", "Valor"],
  rows: [
    ['=HYPERLINK("https://evil.example","x")', 1],
    ["@SUM(1+1)", null],
    ["+1+cmd|' /C calc'!A0", 2],
    ["-3,2%", -3.2],
    ["\tTAB", 0],
    ["Fortaleza", 0],
  ],
  metadata: [{ label: "UF", value: "=cmd" }],
  sources: ["Fonte oficial"],
  methodology: ["Ausência não vira zero."],
  generatedAt: "2026-10-13T00:00:00.000Z",
  url: "https://www.apprepbrasil.com.br/comparar?tipo=partido",
};

describe("CSV exportado não executa fórmulas na planilha", () => {
  const lines = reportCsv(REPORT).replace(/^﻿/, "").split("\r\n");

  it("prefixa texto que começa como fórmula", () => {
    expect(lines).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")";1`);
    expect(lines).toContain("'@SUM(1+1);—");
    expect(lines).toContain("'+1+cmd|' /C calc'!A0;2");
    expect(lines).toContain("'\tTAB;0");
    expect(lines).toContain("UF;'=cmd");
  });

  it("preserva números negativos, texto comum, zero real e ausência", () => {
    expect(lines).toContain("-3,2%;-3.2");
    expect(lines).toContain("Fortaleza;0");
  });
});
