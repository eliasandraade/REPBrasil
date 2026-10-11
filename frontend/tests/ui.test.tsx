import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Term } from "@/components/ui/Term";
import GlossaryPage from "@/app/glossario/page";
import { GLOSSARY, outcomeTerm } from "@/lib/glossary";

describe("termos com explicação", () => {
  it("botão alcançável por teclado/toque, ligado à dica por aria-describedby; Esc fecha", () => {
    render(
      <p>
        Percentual sobre os <Term id="votos-validos">votos válidos</Term>.
      </p>,
    );
    const button = screen.getByRole("button", { name: "votos válidos" });
    const tip = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toContain("Brancos e nulos não entram");
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(document.activeElement).not.toBe(button);
  });

  it("resultado oficial do TSE aponta para o termo certo", () => {
    expect(outcomeTerm("ELEITO POR QP")).toBe("qp");
    expect(outcomeTerm("ELEITO POR MÉDIA")).toBe("media");
    expect(outcomeTerm("SUPLENTE")).toBe("suplente");
    expect(outcomeTerm("NÃO ELEITO")).toBeNull();
  });

  it("o glossário lista todos os termos, cada um com âncora", () => {
    render(<GlossaryPage />);
    for (const id of Object.keys(GLOSSARY)) expect(document.getElementById(id)).toBeTruthy();
    expect(screen.getByText(/ausência de dado não é zero/)).toBeTruthy();
  });
});

describe("estados de dado", () => {
  it("erro é alerta com saída; carregando é esqueleto ocupado; sem cobertura não vira zero", () => {
    let retried = 0;
    const { rerender } = render(<DataState kind="error" title="Falhou" action={<RetryButton onRetry={() => retried++} />} />);
    expect(screen.getByRole("alert").textContent).toContain("Falhou");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retried).toBe(1);
    rerender(<DataState kind="loading" title="Carregando território" />);
    expect(screen.getByLabelText("Carregando território").getAttribute("aria-busy")).toBe("true");
    rerender(<DataState kind="no_coverage">Sem Boletim de Urna importado.</DataState>);
    expect(screen.getByRole("status").textContent).toBe("Sem coberturaSem Boletim de Urna importado.");
  });

  it("selo de fonte: quem publica sempre visível, proveniência sob demanda", () => {
    render(
      <SourceBadge
        publisher="TSE"
        dataset="Candidaturas (Dados Abertos)"
        details={[{ label: "SHA-256 ZIP", value: "abc123…", title: "abc123def456", mono: true }]}
      />,
    );
    expect(screen.getByText("TSE")).toBeTruthy();
    expect(screen.queryByText("SHA-256 ZIP")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "proveniência" }));
    expect(screen.getByText("abc123…").getAttribute("title")).toBe("abc123def456");
  });
});
