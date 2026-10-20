import { describe, expect, it } from "vitest";
import {
  layoutPng,
  pdfTextWidth,
  PDF_TEXT_WIDTH,
  PNG_TEXT_WIDTH,
  reportCsv,
  reportPdf,
  reportXlsx,
  type ExportReport,
} from "@/lib/export/report";

// URL real do comparador exportada no smoke humano de 20/10/2026 (207 caracteres, sem espaço).
const URL =
  "https://www.apprepbrasil.com.br/comparar?tipo=municipio&uf=CE&itens=2304400%2C2312908&periodo=2022&metricas=atlas.idhm%2Cibge.gdp_total%2Cibge.population%2Cibge.literacy_rate_15_plus%2Cderived.gdp_per_capita";

const REPORT: ExportReport = {
  filename: "repbrasil-municipios-2022",
  title: "REPBrasil — Comparação de municípios",
  subtitle: "CE · período 2022",
  headers: ["Indicador", "Unidade", "Fortaleza", "Sobral"],
  rows: [
    ["Taxa de alfabetização (15+)", "%", 94.38, 87.12],
    ["IDHM", "índice", null, null],
  ],
  metadata: [{ label: "UF", value: "CE" }],
  sources: ["IBGE/SIDRA — Censo Demográfico 2022 · SIDRA 4709/93"],
  methodology: [
    "Ausência de observação permanece ausência. Insights extremos são descritivos e determinísticos, sem inferência causal ou normativa.",
  ],
  generatedAt: "2026-10-20T03:04:41.432Z",
  url: URL,
};

// Bytes WinAnsi 0x80–0x9F usados nos relatórios; o resto coincide com Latin-1. (O TextDecoder
// "windows-1252" do Node decodifica essa faixa como Latin-1, por isso a tabela explícita.)
const WIN_ANSI = new Map([[0x80, "€"], [0x85, "…"], [0x91, "‘"], [0x92, "’"], [0x93, "“"], [0x94, "”"], [0x95, "•"], [0x96, "–"], [0x97, "—"]]);

/** Texto de cada linha do PDF (`<hex> Tj`), decodificado de WinAnsi. */
function pdfLines(bytes: Uint8Array): string[] {
  const pdf = new TextDecoder().decode(bytes);
  return [...pdf.matchAll(/<([0-9a-f]*)> Tj/g)].map(([, hex]) =>
    (hex.match(/../g) ?? [])
      .map((pair) => Number.parseInt(pair, 16))
      .map((byte) => WIN_ANSI.get(byte) ?? String.fromCodePoint(byte))
      .join(""),
  );
}

// Métrica fixa para testar o layout do PNG sem canvas: 9 px por caractere no corpo, 18 px no título.
const measureChar = (_char: string, font: string) => (font.includes("32px") ? 18 : 9);
const pngWidth = (text: string, font: string) => Array.from(text).length * measureChar("", font);

describe("exports mantêm a URL reproduzível inteira", () => {
  it("PDF quebra a URL dentro da página sem perder caractere", () => {
    const lines = pdfLines(reportPdf(REPORT));
    expect(lines.join("")).toContain(URL);
    for (const line of lines) expect(pdfTextWidth(line)).toBeLessThanOrEqual(PDF_TEXT_WIDTH);
    // A quebra prefere separadores da URL: nenhum `%2C` é partido entre linhas.
    expect(lines.some((line) => line.endsWith("%") || line.endsWith("%2"))).toBe(false);
  });

  it("PDF quebra token sem separadores e mantém acentos e texto comum", () => {
    const token = `https://www.apprepbrasil.com.br/${"W".repeat(300)}`;
    const lines = pdfLines(reportPdf({ ...REPORT, url: token }));
    expect(lines.join("")).toContain(token);
    for (const line of lines) expect(pdfTextWidth(line)).toBeLessThanOrEqual(PDF_TEXT_WIDTH);
    expect(lines).toContain("REPBrasil — Comparação de municípios");
    expect(lines).toContain("Taxa de alfabetização (15+) | % | 94.38 | 87.12");
    expect(lines).toContain("IDHM | índice | — | —");
  });

  it("PNG quebra a URL em várias linhas e a imagem cresce", () => {
    const layout = layoutPng(REPORT, measureChar);
    expect(layout.lines.map((line) => line.text).join("")).toContain(URL);
    for (const line of layout.lines) expect(pngWidth(line.text, line.font)).toBeLessThanOrEqual(PNG_TEXT_WIDTH);
    const ys = layout.lines.map((line) => line.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(layout.height).toBeGreaterThanOrEqual(Math.max(...ys));
    expect(layout.lines.filter((line) => line.text.includes("apprepbrasil")).length).toBe(1);
  });

  it("PNG com tabela enorme avisa o limite e preserva todo o contexto", () => {
    const rows = Array.from({ length: 2000 }, (_, index) => [`Município ${index}`, "%", index, null]);
    const layout = layoutPng({ ...REPORT, rows }, measureChar);
    const texts = layout.lines.map((line) => line.text);
    expect(texts.join("")).toContain(URL);
    expect(layout.height).toBeLessThanOrEqual(32000);
    const note = texts.find((text) => text.startsWith("PNG limitado às primeiras"));
    expect(note).toMatch(/^PNG limitado às primeiras \d+ linhas; CSV\/XLSX preservam todas as 2000\.$/);
    const shown = Number(note?.match(/primeiras (\d+)/)?.[1]);
    expect(texts.filter((text) => text.startsWith("Município ")).length).toBe(shown);
  });

  it("CSV e XLSX trazem a URL inteira, e o CSV mantém o ponto decimal", () => {
    const csv = reportCsv(REPORT);
    expect(csv).toContain(`URL reproduzível;${URL}\r\n`);
    expect(csv).toContain("Taxa de alfabetização (15+);%;94.38;87.12\r\n");
    expect(new TextDecoder().decode(reportXlsx(REPORT))).toContain(`<t>${URL.replaceAll("&", "&amp;")}</t>`);
  });
});
