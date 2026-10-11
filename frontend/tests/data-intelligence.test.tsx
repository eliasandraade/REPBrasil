import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataExplorer } from "@/components/data/DataExplorer";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const catalog = [
  { code: "ibge.population", name: "População", unit: "pessoas", provider: "IBGE/SIDRA", description: "População municipal.", derived: false },
  { code: "atlas.idhm", name: "IDHM", unit: "índice", provider: "Atlas", description: "IDHM municipal.", derived: false },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((raw: string) => {
    const url = new URL(raw);
    if (url.pathname.endsWith("/indicators")) return json(catalog);
    if (url.pathname.endsWith("/values")) return json([
      { indicatorCode: "ibge.population", municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", period: 2022, value: 100, provider: "IBGE", dataset: "fixture-oficial", retrievedAt: "2026-10-11T00:00:00Z" },
      { indicatorCode: "ibge.population", municipalityIbgeCode: "2304707", municipalityName: "General Sampaio", period: 2022, value: 50, provider: "IBGE", dataset: "fixture-oficial", retrievedAt: "2026-10-11T00:00:00Z" },
    ]);
    if (url.pathname.endsWith("/correlation")) return json({
      xIndicator: "ibge.population", yMetric: "atlas.idhm", period: 2022, n: 2, pearson: 1, spearman: 1,
      methodology: "método", caveat: "Correlação não implica causalidade.",
      points: [
        { municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", x: 100, y: 0.75 },
        { municipalityIbgeCode: "2304707", municipalityName: "General Sampaio", x: 50, y: 0.65 },
      ],
    });
    if (url.pathname.endsWith("/clusters")) return json({ indicator: "ibge.population", period: 2022, k: 3, centroids: [50, 75, 100], methodology: "determinístico", items: [
      { municipalityIbgeCode: "2304400", municipalityName: "Fortaleza", value: 100, cluster: 2 },
      { municipalityIbgeCode: "2304707", municipalityName: "General Sampaio", value: 50, cluster: 0 },
    ] });
    return json({}, 404);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("Data Intelligence", () => {
  it("keeps the causality caveat visible and renders N, scatter, table and clusters", async () => {
    render(<DataExplorer />);
    expect(screen.getByTestId("causality-caveat").textContent).toContain("Correlação não implica causalidade");
    await waitFor(() => expect(screen.getByTestId("correlation-summary").textContent).toContain("2"));
    expect(screen.getByTestId("data-scatter")).toBeTruthy();
    expect(screen.getByTestId("correlation-table").textContent).toContain("General Sampaio");
    expect(screen.getByTestId("clusters").textContent).toContain("determinístico");
    expect(screen.getByText(/Fonte da observação mais recente exibida/).textContent).toContain("IBGE");
  });
});
