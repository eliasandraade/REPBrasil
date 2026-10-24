import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ufMesh from "../public/geo/br-uf.json";
import { MATH_DEFINED_LINE_1, MATH_DEFINED_LINE_2, MATH_DEFINED_TITLE, PhaseBanners } from "@/components/live-election/Banners";
import { BrazilElectionMap, ExteriorCard } from "@/components/live-election/BrazilElectionMap";
import { Hero } from "@/components/live-election/Hero";
import { LiveStoreProvider } from "@/components/live-election/LiveContext";
import { DistanceCard } from "@/components/live-election/MathStatus";
import { StateResultsTable } from "@/components/live-election/StateTable";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { projectBrazil } from "@/lib/live-election/map-shapes";
import { createLiveStore, initialLiveState, type LiveStore } from "@/lib/live-election/store";
import type { LiveSummary } from "@/lib/live-election/types";
import { envelope, meta, SCENARIOS, statesPayload } from "./fixtures/live-election";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/live-election/api", async (original) => ({
  ...(await original<typeof import("@/lib/live-election/api")>()),
  sendProductEvent: vi.fn(),
}));

function storeFor(summary: LiveSummary, version = 10): LiveStore {
  return createLiveStore(initialLiveState(envelope(summary, version, { phase: summary.phase }), envelope(statesPayload(), version)), {
    schedule: (run) => run(),
  });
}

function renderWith(store: LiveStore, ui: ReactNode) {
  return render(<LiveStoreProvider store={store}>{ui}</LiveStoreProvider>);
}

const page = (summary: LiveSummary) =>
  renderWith(
    storeFor(summary),
    <>
      <Hero />
      <PhaseBanners />
      <DistanceCard />
    </>,
  );

describe("estados da página", () => {
  it("antes do início: candidaturas sem números e texto oficial de espera (nunca zeros)", () => {
    page(SCENARIOS.preElection);
    expect(screen.getByTestId("live-pre-election").textContent).toContain("Totalização ainda não iniciada");
    expect(screen.getByTestId("live-pre-election").textContent).toContain("25 de outubro de 2026");
    expect(screen.getByTestId("live-pre-election").textContent).toContain("Dados oficiais serão exibidos assim que forem liberados pelo TSE.");
    expect(screen.queryByTestId("live-candidate-a-pct")).toBeNull();
    expect(screen.getAllByText("Aguardando a totalização oficial")).toHaveLength(2);
    expect(screen.queryByTestId("live-proportional-bar")).toBeNull();
    expect(screen.queryByTestId("live-distance-card")).toBeNull();
    expect(screen.queryByTestId("live-math-defined-banner")).toBeNull();
  });

  it("dv=n: votação não liberada, sem placar", () => {
    page(SCENARIOS.waitingRelease);
    expect(screen.getByTestId("live-waiting-release").textContent).toContain("Dados de votação ainda não liberados para divulgação.");
    expect(screen.queryByTestId("live-candidate-a-pct")).toBeNull();
  });

  it("ao vivo: placar, AO VIVO e card de distância; sem banner de definição", () => {
    page(SCENARIOS.half);
    expect(screen.getAllByTestId("live-status-pill")[0].textContent).toContain("AO VIVO");
    expect(screen.getByTestId("live-candidate-a-pct").textContent).toBe("51,28%");
    expect(screen.getByTestId("live-distance-card")).toBeTruthy();
    expect(screen.getByTestId("live-distance-value").textContent).not.toBe("—");
    expect(screen.queryByTestId("live-math-defined-banner")).toBeNull();
  });

  it.each([
    ["md ausente", SCENARIOS.mdAbsent],
    ["md=n", SCENARIOS.mdN],
    ["limite independente atingido sem md=e", SCENARIOS.independentReached],
  ])("%s: nenhum banner de definição matemática", (_label, summary) => {
    page(summary);
    expect(screen.queryByTestId("live-math-defined-banner")).toBeNull();
    expect(screen.queryByText(/ELEITO/)).toBeNull();
  });

  it("limite independente atingido sem md=e: distância retida, só a nota oficial", () => {
    page(SCENARIOS.independentReached);
    expect(screen.queryByTestId("live-distance-value")).toBeNull();
    expect(screen.getByTestId("live-distance-withheld").textContent).toContain("A definição matemática é sinalizada oficialmente pelo TSE.");
  });

  it("md=e com tf=n: banner com as frases oficiais exatas", () => {
    page(SCENARIOS.mathDefined);
    const banner = screen.getByTestId("live-math-defined-banner");
    expect(within(banner).getByText(MATH_DEFINED_TITLE)).toBeTruthy();
    expect(within(banner).getByText(MATH_DEFINED_LINE_1)).toBeTruthy();
    expect(within(banner).getByText(MATH_DEFINED_LINE_2)).toBeTruthy();
    expect(banner.textContent).toContain("CANDIDATO A");
    expect(screen.queryByTestId("live-distance-card")).toBeNull();
    expect(screen.queryByTestId("live-final-banner")).toBeNull();
  });

  it("tf=s: RESULTADO FINAL, sem AO VIVO e sem banner de definição", () => {
    page(SCENARIOS.final);
    expect(screen.getByTestId("live-final-banner").textContent).toContain("RESULTADO FINAL");
    for (const pill of screen.getAllByTestId("live-status-pill")) expect(pill.textContent).not.toContain("AO VIVO");
    expect(screen.queryByTestId("live-math-defined-banner")).toBeNull();
    expect(screen.getAllByTestId("live-candidate-situation")[0].textContent).toBe("Eleito");
  });

  it("fonte defasada: mantém o último placar e avisa", () => {
    page(SCENARIOS.stale);
    expect(screen.getByTestId("live-candidate-a-pct").textContent).not.toBe("—");
    expect(screen.getByTestId("live-stale-notice").textContent).toContain("Aguardando nova atualização da fonte.");
  });

  it("reprocessamento (mntf): mensagem técnica", () => {
    page(SCENARIOS.reprocessing);
    expect(screen.getByTestId("live-reprocessing").textContent).toContain("Atualização de registro de candidatura");
  });

  it("modo replay/simulação leva selo; oficial não", () => {
    const store = createLiveStore(initialLiveState(envelope(SCENARIOS.half, 10, { mode: "replay" }), null), { schedule: (run) => run() });
    renderWith(store, <Hero />);
    expect(screen.getAllByTestId("live-mode-badge")[0].textContent).toContain("REPLAY");
  });

  it("atualização ao vivo muda só o placar (snapshot novo substitui o anterior)", () => {
    const store = storeFor(SCENARIOS.half);
    renderWith(store, <Hero />);
    const { election: _e, candidates: _c, events: _ev, ...rest } = SCENARIOS.leadAfter;
    act(() => store.dispatch({ type: "national-update", envelope: { data: rest, meta: meta(11) } }));
    expect(screen.getByTestId("live-candidate-a-pct").textContent).toBe(`${(22 / 45 * 100).toFixed(2).replace(".", ",")}%`);
  });
});

describe("mapa", () => {
  const shapes = projectBrazil(ufMesh as unknown as TerritoryCollection);

  it("27 UFs com rótulo acessível completo e só uma no Tab (setas percorrem)", () => {
    const onSelect = vi.fn();
    renderWith(storeFor(SCENARIOS.half), <BrazilElectionMap shapes={shapes} onSelect={onSelect} />);
    const ufs = screen.getAllByRole("button").filter((el) => el.getAttribute("data-uf"));
    expect(ufs).toHaveLength(27);
    expect(ufs.filter((el) => el.getAttribute("tabindex") === "0")).toHaveLength(1);
    const sp = ufs.find((el) => el.getAttribute("data-uf") === "SP")!;
    expect(sp.getAttribute("aria-label")).toMatch(/São Paulo: CANDIDATO [AB] à frente por .* das seções totalizadas/);
    const rr = ufs.find((el) => el.getAttribute("data-uf") === "RR")!;
    expect(rr.getAttribute("aria-label")).toContain("sem votos totalizados");
    expect(ufs.find((el) => el.getAttribute("data-uf") === "DF")!.getAttribute("aria-label")).toContain("empate");

    const first = ufs.find((el) => el.getAttribute("tabindex") === "0")!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const next = document.activeElement as Element;
    expect(next).not.toBe(first);
    expect(next.getAttribute("data-uf")).toBeTruthy();
    fireEvent.keyDown(next, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(next.getAttribute("data-uf"));
  });

  it("legenda não depende só de cor e oferece a tabela", () => {
    renderWith(storeFor(SCENARIOS.half), <BrazilElectionMap shapes={shapes} onSelect={() => undefined} />);
    const legend = screen.getByTestId("live-map-legend");
    expect(legend.textContent).toContain("hachurado");
    expect(legend.textContent).toContain("Empate");
    expect(within(legend).getByText("Ver os mesmos dados em tabela").getAttribute("href")).toBe("#live-state-table");
  });

  it("exterior fora do mapa abre o painel ZZ", () => {
    const onSelect = vi.fn();
    renderWith(storeFor(SCENARIOS.half), <ExteriorCard onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Detalhes" }));
    expect(onSelect).toHaveBeenCalledWith("ZZ");
  });
});

describe("tabela das UFs", () => {
  it("ordena por qualquer coluna (aria-sort) e filtra pela busca", () => {
    renderWith(storeFor(SCENARIOS.half), <StateResultsTable onSelect={() => undefined} />);
    const header = screen.getAllByRole("columnheader").find((th) => th.textContent?.includes("Dif. p.p."))!;
    expect(header.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.change(screen.getByLabelText("Buscar UF"), { target: { value: "sao paulo" } });
    expect(screen.getAllByTestId("live-state-row").map((r) => r.getAttribute("data-uf"))).toEqual(["SP"]);
  });
});
