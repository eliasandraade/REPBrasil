import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  electionHref,
  electionYears,
  partyHref,
  placesWithoutData,
  searchOptions,
  searchableQuery,
  territoryHref,
  type SearchResponse,
} from "@/lib/search";

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: nav.push, prefetch: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SearchBox } from "@/components/search/GlobalSearch";
import { NavigationProvider } from "@/motion/navigation";

const RESPONSE: SearchResponse = {
  query: "fortaleza 2024",
  filter: { year: 2024, round: null, officeCode: null, officeName: null },
  order: ["elections", "territories", "politicians"],
  politicians: [
    {
      id: "p1",
      name: "Morgana Kelly Bezerra Fortaleza",
      ballotName: "Dra Morgana Fortaleza",
      slug: "dra-morgana-fortaleza",
      rank: 2,
      candidacy: { year: 2024, round: 1, officeCode: 13, officeName: "Vereador", unitName: "Campos Sales", uf: "CE", party: "PSB", elected: true },
    },
  ],
  territories: [
    { kind: "municipality", uf: "CE", tseCode: "13897", name: "Fortaleza", slug: "fortaleza", stateName: "Ceará", rank: 0, elections: [{ year: 2024, round: 2 }, { year: 2024, round: 1 }, { year: 2022, round: 1 }] },
    { kind: "municipality", uf: "MG", tseCode: "45250", name: "Fortaleza de Minas", slug: "fortaleza-de-minas", stateName: "Minas Gerais", rank: 1, elections: [] },
  ],
  parties: [],
  elections: [
    { year: 2024, round: 1, uf: "CE", municipality: "fortaleza", placeName: "Fortaleza", officeCode: 11, officeName: "Prefeito", rank: 0, label: "Prefeito · Fortaleza · Eleições 2024 · 1º turno" },
  ],
};

describe("destinos da busca", () => {
  it("leva cada resultado a uma rota que já existe", () => {
    expect(territoryHref(RESPONSE.territories[0])).toBe("/municipios/ce/fortaleza");
    expect(territoryHref({ ...RESPONSE.territories[0], kind: "state", slug: null })).toBe("/estados/ce");
    expect(electionHref(RESPONSE.elections[0])).toBe("/eleicoes/2024/1/ce/fortaleza?cargo=11");
    expect(electionHref({ ...RESPONSE.elections[0], municipality: null, officeCode: null })).toBe("/eleicoes/2024/1/ce");
    expect(partyHref({ acronym: "PC do B", name: null, number: 65, candidacies: 1, year: 2024, round: 1, rank: 0 })).toBe("/politicos?party=PC+do+B");
  });

  it("lugar sem eleição importada não vira link (não há para onde ir)", () => {
    expect(territoryHref(RESPONSE.territories[1])).toBeNull();
    expect(searchOptions(RESPONSE).map((o) => o.group)).toEqual(["elections", "territories", "politicians"]);
    expect(placesWithoutData(RESPONSE).map((t) => t.name)).toEqual(["Fortaleza de Minas"]);
  });

  it("só busca a partir de 2 caracteres e corta consultas longas", () => {
    expect(searchableQuery(" a ")).toBeNull();
    expect(searchableQuery(" pt ")).toBe("pt");
    expect(searchableQuery("x".repeat(200))).toHaveLength(80);
  });

  it("anos distintos em linguagem natural", () => {
    expect(electionYears(RESPONSE.territories[0].elections)).toBe("2024 e 2022");
    expect(electionYears([{ year: 2026, round: 1 }])).toBe("2026");
  });
});

describe("combobox de busca", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    nav.push.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderBox() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <NavigationProvider>
          <SearchBox variant="dialog" />
        </NavigationProvider>
      </QueryClientProvider>,
    );
  }

  it("mostra exemplos com o campo vazio e não chama a API", () => {
    renderBox();
    expect(screen.getByRole("button", { name: "Deputado Federal 2022" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("agrupa na ordem do servidor, navega com setas e abre com Enter", async () => {
    renderBox();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "fortaleza 2024" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/search?q=fortaleza+2024");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby"))).toHaveLength(3);
    expect(screen.getByText("Filtrando por")).toBeTruthy();
    expect(screen.getByText(/Ainda sem eleições importadas: Fortaleza de Minas \(MG\)/)).toBeTruthy();

    // 1ª opção já ativa (eleição), seta para baixo → lugar
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith("/municipios/ce/fortaleza", expect.anything());
  });

  it("nunca mostra resultado antigo sob uma consulta nova", async () => {
    renderBox();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "fortaleza 2024" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(document.querySelector("[data-pending]")?.getAttribute("data-pending")).toBe("false");

    fireEvent.change(input, { target: { value: "fortaleza 2022" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0); // some na hora, antes do debounce
    expect(document.querySelector("[data-pending]")?.getAttribute("data-pending")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Buscando “fortaleza 2022”…");
  });

  it("Esc limpa o campo antes de fechar", async () => {
    const onEscapeEmpty = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SearchBox variant="dialog" onEscapeEmpty={onEscapeEmpty} />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pt" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(onEscapeEmpty).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEscapeEmpty).toHaveBeenCalledTimes(1);
  });

  it("diz quando não encontra nada", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...RESPONSE, order: [], politicians: [], territories: [], elections: [], filter: { year: null, round: null, officeCode: null, officeName: null } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderBox();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(screen.getByText(/Nada encontrado para “zzzz”\. Tente/)).toBeTruthy());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
