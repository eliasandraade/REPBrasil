import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectionResults } from "@/components/elections/SectionResults";
import { parseElectionsPath } from "@/lib/elections/route";
import { sectionResults } from "./fixtures";

const route = parseElectionsPath("/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381")!;

function renderResults(over: Partial<Parameters<typeof SectionResults>[0]> = {}) {
  const props = {
    route,
    municipalityName: "Fortaleza/CE",
    data: sectionResults(381),
    status: "ready" as const,
    isAggregatedInCadaster: false,
    principalNumber: 381,
    voteType: "todos" as const,
    onOffice: vi.fn(),
    onVoteType: vi.fn(),
    closeHref: "/eleicoes/2026/1/ce/fortaleza/zona/94",
    onRetry: vi.fn(),
    ...over,
  };
  render(<SectionResults {...props} />);
  return props;
}

describe("resultado da seção", () => {
  it("métricas: null aparece como —, nunca 0", () => {
    renderResults();
    const metrics = screen.getByTestId("metrics");
    expect(within(metrics).getByText("336")).toBeTruthy();
    expect(within(metrics).getByLabelText("Nulos: não informado pela fonte").textContent).toBe("—");
  });

  it("candidato com vínculo validado abre o perfil REPBrasil; sem vínculo continua visível sem link", () => {
    renderResults();
    const link = screen.getByTestId("candidate-profile-link");
    expect(link.getAttribute("href")).toBe("/politicos/pol-1?aba=eleicoes");
    expect(link.textContent).toBe("Candidata Com Perfil");
    const unlinked = screen.getByText("Candidato Sem Perfil");
    expect(unlinked.closest("a")).toBeNull();
    expect(screen.getAllByTestId("no-profile")).toHaveLength(1);
    // voto do candidato sem perfil continua correto
    expect(within(unlinked.closest("li")!).getByText("130")).toBeTruthy();
  });

  it("branco não recebe percentual; nominal sim, sobre os válidos", () => {
    renderResults();
    const branco = document.querySelector('[data-vote-type="branco"]')!;
    expect(branco.textContent).not.toContain("%");
    expect(document.querySelector('[data-vote="11"]')!.textContent).toContain("54,06%");
  });

  it("cargo e tipo de voto são filtros explícitos", () => {
    const props = renderResults();
    fireEvent.click(screen.getByRole("tab", { name: "Governador" }));
    expect(props.onOffice).toHaveBeenCalledWith(3);
    fireEvent.click(document.querySelector('[data-vote-filter="legenda"]')!);
    expect(props.onVoteType).toHaveBeenCalledWith("legenda");
  });

  it("seção agregada aponta para a urna principal e não exibe votos próprios", () => {
    renderResults({ route: { ...route, section: 79 }, isAggregatedInCadaster: true, principalNumber: 58, data: null, status: "loading" });
    expect(screen.getByTestId("section-results").dataset.aggregated).toBe("true");
    expect(screen.getByRole("link", { name: "Ver seção principal 058" }).getAttribute("href")).toBe(
      "/eleicoes/2026/1/ce/fortaleza/zona/94/secao/58",
    );
    expect(screen.queryByTestId("vote-list")).toBeNull();
  });

  it("resultado não importado e erro não mostram números", () => {
    renderResults({ data: sectionResults(381, { status: "not_ingested", metrics: null, votes: null }) });
    expect(screen.getByTestId("section-results").dataset.status).toBe("not_ingested");
    expect(screen.queryByTestId("metrics")).toBeNull();
    screen.getByText(/nem zero/);
  });

  it("erro de comunicação ≠ zero votos", () => {
    const props = renderResults({ data: null, status: "error" });
    expect(screen.queryByTestId("metrics")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("fonte TSE com proveniência auditável", () => {
    renderResults();
    const badge = screen.getByTestId("source-badge");
    expect(badge.textContent).toContain("Tribunal Superior Eleitoral");
    fireEvent.click(within(badge).getByRole("button", { name: "proveniência" }));
    expect(badge.textContent).toContain("db72adfff903");
    expect(badge.textContent).toContain("sha512 conferido");
  });
});
