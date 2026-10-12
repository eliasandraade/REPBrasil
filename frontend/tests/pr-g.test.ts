import { describe, expect, it } from "vitest";
import type { Indicator } from "@/lib/data-intelligence";
import { reportCsv, reportPdf, reportXlsx, type ExportReport } from "@/lib/export/report";
import { indicatorHref, searchOptions, withIndicatorResults, type SearchResponse } from "@/lib/search";

const REPORT: ExportReport = {
  filename: "comparacao",
  title: "REPBrasil — José",
  headers: ["Entidade", "Valor"],
  rows: [["A", 0], ["B", null]],
  metadata: [{ label: "UF", value: "CE" }],
  sources: ["Fonte oficial"],
  methodology: ["Ausência não vira zero."],
  generatedAt: "2026-10-11T00:00:00.000Z",
  url: "https://www.apprepbrasil.com.br/comparar?tipo=partido",
};

const SEARCH: SearchResponse = {
  query: "analfabetismo",
  filter: { year: null, round: null, officeCode: null, officeName: null },
  order: [],
  politicians: [],
  territories: [],
  parties: [],
  elections: [],
};

const INDICATORS: Indicator[] = [
  { code: "illiteracy_rate_15_plus", name: "Taxa de analfabetismo (15+)", unit: "%", provider: "IBGE", description: "Percentual municipal", derived: true },
  { code: "population", name: "População residente", unit: "pessoas", provider: "IBGE", description: "População municipal", derived: false },
];

describe("PR G — exports auditáveis", () => {
  it("preserva zero real e representa ausência explicitamente no CSV", () => {
    const csv = reportCsv(REPORT);
    expect(csv).toContain("A;0");
    expect(csv).toContain("B;—");
    expect(csv).toContain("Fonte;Fonte oficial");
    expect(csv).toContain("URL reproduzível;https://www.apprepbrasil.com.br/comparar?tipo=partido");
  });

  it("gera XLSX OpenXML válido e grava ausência como marcador explícito", () => {
    const xlsx = reportXlsx(REPORT);
    expect(Array.from(xlsx.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(xlsx)).toContain("<t>—</t>");
  });

  it("gera PDF válido preservando caracteres portugueses em WinAnsi", () => {
    const pdfBytes = reportPdf(REPORT);
    const pdf = new TextDecoder().decode(pdfBytes);
    expect(pdf.slice(0, 8)).toBe("%PDF-1.4");
    expect(pdf).toContain("4a6f73e9");
    expect(pdf).toContain("97");
  });
});

describe("PR G — busca por indicador", () => {
  it("acrescenta só indicadores compatíveis e mantém a regra determinística", () => {
    const response = withIndicatorResults(SEARCH, INDICATORS, "analfabetismo");
    expect(response?.order).toEqual(["indicators"]);
    expect(response?.indicators?.map((item) => item.code)).toEqual(["illiteracy_rate_15_plus"]);
    expect(searchOptions(response)[0]?.href).toBe("/dados?x=illiteracy_rate_15_plus");
  });

  it("gera link reproduzível para o Data Intelligence", () => {
    expect(indicatorHref({ ...INDICATORS[0], rank: 0 })).toBe("/dados?x=illiteracy_rate_15_plus");
  });
});