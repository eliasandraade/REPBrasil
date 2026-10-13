import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SignInPage from "@/app/entrar/page";
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
