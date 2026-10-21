import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportActions } from "@/components/export/ExportActions";
import { downloadReport, type ExportReport } from "@/lib/export/report";

vi.mock("@/lib/export/report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/export/report")>()),
  downloadReport: vi.fn(async () => undefined),
}));

const REPORT: ExportReport = {
  filename: "repbrasil-partidos",
  title: "REPBrasil — Comparação de partidos",
  headers: ["Partido"],
  rows: [["PT"]],
  metadata: [],
  sources: [],
  methodology: [],
  generatedAt: "2026-10-21T00:00:00Z",
  url: "",
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.mocked(downloadReport).mockClear();
});

describe("export: URL reproduzível", () => {
  it("leva a URL da barra no momento do clique, não a da renderização", async () => {
    window.history.replaceState(null, "", "/comparar?tipo=partido&uf=CE&itens=pt,psb");
    render(<ExportActions report={{ ...REPORT, url: window.location.href }} />);
    // o comparador completa a URL (router.replace) depois de o relatório ter sido montado
    window.history.replaceState(null, "", "/comparar?tipo=partido&uf=CE&itens=pt%2Cpsb&ano=2026&turno=1&cargo=1");

    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(1));
    const [sent, format] = vi.mocked(downloadReport).mock.calls[0];
    expect(format).toBe("csv");
    expect(sent.url).toBe(window.location.href);
    expect(sent.url).toContain("ano=2026&turno=1&cargo=1");
  });
});
