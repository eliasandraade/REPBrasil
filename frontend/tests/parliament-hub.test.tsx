import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParliamentHub } from "@/components/parliament/ParliamentHub";
import { nav } from "./support/next";

vi.mock("@/components/elections/TerritoryMap", () => ({ TerritoryMap: () => null }));

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

const amendment = (index: number, year: number) => ({
  id: index,
  externalId: `EM-${index}`,
  authorMemberId: null,
  authorName: "Autor publicado",
  year,
  amendmentType: null,
  functionalProgramming: null,
  beneficiaryDocument: null,
  beneficiaryName: null,
  locality: null,
  municipalityIbgeCode: null,
  committedAmount: 1,
  paidAmount: null,
  provider: "transparencia",
  dataset: "emendas-parlamentares:CE",
  sourceUrl: "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO",
  retrievedAt: "2026-10-13T00:00:00Z",
});

const activity = (index: number) => ({
  id: index,
  memberId: 1,
  institution: "camara",
  activityType: "proposition",
  externalId: String(index),
  occurredAt: "2026-01-01T00:00:00Z",
  title: `PL ${index}/2026`,
  description: null,
  sourceUrl: null,
  provider: "camara",
  dataset: "proposicoes:deputado-1",
  datasetSourceUrl: "https://dadosabertos.camara.leg.br/api/v2/proposicoes",
  retrievedAt: "2026-10-13T00:00:00Z",
});

let requested: URL[] = [];

beforeEach(() => {
  requested = [];
  vi.stubGlobal("fetch", vi.fn((raw: string) => {
    const url = new URL(raw);
    requested.push(url);
    const path = url.pathname;
    if (path.endsWith("/parliament/members")) return json([]);
    if (path.endsWith("/parliament/activities/count")) return json({ total: 8754 });
    if (path.endsWith("/parliament/activities")) return json(Array.from({ length: 100 }, (_, index) => activity(index + 1)));
    if (path.endsWith("/parliament/amendments/years")) return json([2025, 2024]);
    if (path.endsWith("/parliament/amendments/map")) return json([]);
    // A listagem é limitada a 200 linhas: todas do ano mais recente, nenhuma do ano anterior.
    if (path.endsWith("/parliament/amendments")) return json(Array.from({ length: 200 }, (_, index) => amendment(index + 1, 2025)));
    return Promise.reject(new Error(`unexpected request ${raw}`));
  }));
});

describe("/parlamento — totais e anos não vêm da listagem limitada", () => {
  it("o seletor oferece todos os anos da edição vigente, inclusive os que a listagem de 200 não traz", async () => {
    render(<ParliamentHub />);

    const select = screen.getByLabelText("Ano — emendas");
    await waitFor(() => expect(within(select).getByRole("option", { name: "2024" })).toBeTruthy());
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Todos os anos carregados", "2025", "2024"]);

    const years = requested.find((url) => url.pathname.endsWith("/parliament/amendments/years"));
    expect(years?.searchParams.get("uf")).toBe("CE");
    await waitFor(() => expect(screen.getAllByText("Autor publicado")).toHaveLength(200));
    expect(screen.queryAllByRole("cell", { name: "2024" })).toHaveLength(0);
  });

  it("“Atos no recorte” mostra o total da API e a lista diz que exibe só parte dele", async () => {
    render(<ParliamentHub />);

    const card = screen.getByText("Atos no recorte").closest("article");
    expect(card).not.toBeNull();
    await waitFor(() => expect(within(card as HTMLElement).getByText("8.754")).toBeTruthy());
    expect(await screen.findByText(/Exibindo os 100 mais recentes de 8\.754\./)).toBeTruthy();
    expect(within(card as HTMLElement).queryByText("100")).toBeNull();

    const total = requested.find((url) => url.pathname.endsWith("/parliament/activities/count"));
    expect(total?.searchParams.get("uf")).toBe("CE");
  });
});

describe("/parlamento — o recorte vive na URL", () => {
  afterEach(() => {
    nav.search = "";
    nav.replace.mockReset();
  });

  it("UF, parlamentar e ano da URL (links das notificações) chegam à API e aos filtros", async () => {
    nav.search = "uf=pe&membro=7&ano=2024";
    render(<ParliamentHub />);
    await waitFor(() => expect(requested.some((url) => url.pathname.endsWith("/parliament/amendments"))).toBe(true));
    const amendments = requested.find((url) => url.pathname.endsWith("/parliament/amendments"));
    expect([amendments?.searchParams.get("uf"), amendments?.searchParams.get("year")]).toEqual(["PE", "2024"]);
    const activities = requested.find((url) => url.pathname.endsWith("/parliament/activities"));
    expect([activities?.searchParams.get("uf"), activities?.searchParams.get("memberId")]).toEqual(["PE", "7"]);
    expect((screen.getByLabelText("UF") as HTMLSelectElement).value).toBe("PE");
  });

  it("trocar a UF grava a URL e limpa parlamentar e ano", () => {
    nav.search = "uf=CE&ano=2025";
    render(<ParliamentHub />);
    fireEvent.change(screen.getByLabelText("UF"), { target: { value: "SP" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/?uf=SP", { scroll: false });
  });
});
