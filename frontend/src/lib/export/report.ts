export type ReportValue = string | number | null;

export interface ReportMeta {
  label: string;
  value: string;
}

export interface ExportReport {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: ReportValue[][];
  metadata: ReportMeta[];
  sources: string[];
  methodology: string[];
  generatedAt: string;
  url: string;
}

const encoder = new TextEncoder();
const utf8 = (value: string) => encoder.encode(value);

function trimHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start += 1;
  while (end > start && value[end - 1] === "-") end -= 1;
  return value.slice(start, end);
}

export function exportFilename(value: string): string {
  const cleaned = trimHyphens(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-"),
  );
  return cleaned || "repbrasil-export";
}

function text(value: ReportValue): string {
  return value === null ? "—" : String(value);
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const SIGNED_NUMBER = /^[+-][\d.,]+%?$/;

/**
 * Texto que uma planilha interpretaria como fórmula (=, +, -, @, tab, CR no início) ganha um
 * apóstrofo e é exibido literalmente; números com sinal e valores numéricos seguem intactos.
 */
function spreadsheetSafe(raw: string): string {
  return FORMULA_TRIGGER.test(raw) && !SIGNED_NUMBER.test(raw) ? `'${raw}` : raw;
}

function csvCell(value: ReportValue): string {
  const raw = typeof value === "string" ? spreadsheetSafe(value) : text(value);
  return /[;"\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function reportCsv(report: ExportReport): string {
  const context = [
    [report.title],
    ...(report.subtitle ? [[report.subtitle]] : []),
    ...report.metadata.map((item) => [item.label, item.value]),
    ["Gerado em", report.generatedAt],
    ["URL reproduzível", report.url],
    ...report.sources.map((source) => ["Fonte", source]),
    ...report.methodology.map((item) => ["Metodologia", item]),
    [],
  ];
  const rows = [...context, report.headers, ...report.rows];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function columnName(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCodePoint(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function worksheetRows(report: ExportReport): ReportValue[][] {
  return [
    [report.title],
    ...(report.subtitle ? [[report.subtitle]] : []),
    ...report.metadata.map((item) => [item.label, item.value]),
    ["Gerado em", report.generatedAt],
    ["URL reproduzível", report.url],
    ...report.sources.map((source) => ["Fonte", source]),
    ...report.methodology.map((item) => ["Metodologia", item]),
    [],
    report.headers,
    ...report.rows,
  ];
}

function sheetXml(report: ExportReport): string {
  const rows = worksheetRows(report)
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          const rendered = value === null ? "—" : String(value);
          return `<c r="${ref}" t="inlineStr"><is><t>${xml(rendered)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function zipStore(entries: ZipEntry[]): Uint8Array {
  const body: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  const dosDate1980 = 0x0021;
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(dosDate1980), u32(crc), u32(entry.data.length), u32(entry.data.length),
      u16(name.length), u16(0), name, entry.data,
    ]);
    body.push(local);
    directory.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(dosDate1980), u32(crc), u32(entry.data.length), u32(entry.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = concat(directory);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0),
  ]);
  return concat([...body, central, end]);
}

export function reportXlsx(report: ExportReport): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="REPBrasil" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheetXml(report)) },
  ]);
}

const WIN_ANSI_SPECIAL = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function winAnsiByte(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0x3f;
  return codePoint <= 0xff ? codePoint : (WIN_ANSI_SPECIAL.get(codePoint) ?? 0x3f);
}

function pdfWinAnsiHex(value: string): string {
  let result = "";
  for (const char of value) result += winAnsiByte(char).toString(16).padStart(2, "0");
  return result;
}

/**
 * Largura de cada glifo da Helvetica (métricas AFM das fontes padrão do PDF), em milésimos de em,
 * indexada pelo byte WinAnsi. Byte sem glifo conta como 1000, a maior largura possível.
 */
const HELVETICA_WIDTHS = (() => {
  const widths = new Array<number>(256).fill(1000);
  const put = (first: number, values: number[]) => values.forEach((value, index) => { widths[first + index] = value; });
  put(0x20, [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ]);
  put(0x80, [
    556, 1000, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 1000, 611, 1000,
    1000, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 1000, 500, 667,
  ]);
  put(0xa0, [
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
  ]);
  return widths;
})();

const PDF_FONT_SIZE = 9;
const PDF_MARGIN = 42;
/** Largura útil da linha no PDF: página A4 (595 pt) com 42 pt de margem dos dois lados. */
export const PDF_TEXT_WIDTH = 595 - 2 * PDF_MARGIN;

const pdfCharWidth = (char: string) => (HELVETICA_WIDTHS[winAnsiByte(char)] * PDF_FONT_SIZE) / 1000;

/** Soma das larguras dos caracteres de `value`, medidos com `charWidth`. */
function textWidth(value: string, charWidth: (char: string) => number): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

/** Largura, em pontos, de uma linha do PDF (Helvetica 9 pt). */
export function pdfTextWidth(value: string): number {
  return textWidth(value, pdfCharWidth);
}

// Depois destes caracteres uma URL quebra sem perder legibilidade; antes de `%` também (mantém `%2C` inteiro).
const BREAK_AFTER = new Set(["/", "&", "?", "=", ",", ";", ".", "-", "_"]);

/** Ponto de quebra no trecho `[start, end)` de um token: depois de um separador ou antes de `%`, na metade final. */
function breakIndex(chars: string[], start: number, end: number): number {
  for (let index = end; index > start + (end - start) / 2; index -= 1) {
    if (BREAK_AFTER.has(chars[index - 1]) || chars[index] === "%") return index;
  }
  return end;
}

/** Quebra um token mais largo que a linha: devolve as linhas cheias e o resto, que ainda aceita palavras. */
function splitToken(chars: string[], widths: number[], maxWidth: number): { full: string[]; rest: string; restWidth: number } {
  const full: string[] = [];
  let start = 0;
  for (;;) {
    let end = start;
    let width = 0;
    while (end < chars.length && width + widths[end] <= maxWidth) {
      width += widths[end];
      end += 1;
    }
    if (end === chars.length) return { full, rest: chars.slice(start).join(""), restWidth: width };
    // Um caractere mais largo que a linha ainda avança uma posição.
    const cut = breakIndex(chars, start, Math.max(end, start + 1));
    full.push(chars.slice(start, cut).join(""));
    start = cut;
  }
}

/**
 * Quebra `value` em linhas que cabem em `maxWidth`, medindo cada caractere com `charWidth`. Palavras
 * passam inteiras para a linha seguinte, mantendo o espaçamento original dentro da linha; um token mais
 * largo que a linha (uma URL, por exemplo) é quebrado dentro dele, de preferência depois de um
 * separador. Nenhum caractere é descartado.
 */
function wrapText(value: string, maxWidth: number, charWidth: (char: string) => number): string[] {
  if (textWidth(value, charWidth) <= maxWidth) return [value];
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  let gap = "";
  for (const token of value.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s/.test(token)) {
      gap = token;
      continue;
    }
    const chars = Array.from(token);
    const widths = chars.map(charWidth);
    const tokenWidth = widths.reduce((sum, width) => sum + width, 0);
    const gapWidth = textWidth(gap, charWidth);
    if (line && lineWidth + gapWidth + tokenWidth <= maxWidth) {
      line += gap + token;
      lineWidth += gapWidth + tokenWidth;
    } else {
      if (line) lines.push(line);
      const { full, rest, restWidth } = splitToken(chars, widths, maxWidth);
      for (const part of full) lines.push(part);
      line = rest;
      lineWidth = restWidth;
    }
    gap = "";
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export function reportPdf(report: ExportReport): Uint8Array {
  const lines: string[] = [
    report.title,
    ...(report.subtitle ? [report.subtitle] : []),
    "",
    ...report.metadata.map((item) => `${item.label}: ${item.value}`),
    `Gerado em: ${report.generatedAt}`,
    `URL: ${report.url}`,
    ...report.sources.map((source) => `Fonte: ${source}`),
    ...report.methodology.map((item) => `Metodologia: ${item}`),
    "",
    report.headers.join(" | "),
    ...report.rows.map((row) => row.map(text).join(" | ")),
  ].flatMap((line) => wrapText(line, PDF_TEXT_WIDTH, pdfCharWidth));

  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 44) pages.push(lines.slice(index, index + 44));
  if (pages.length === 0) pages.push([report.title]);

  const objects: string[] = [];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const fontId = 3;
  for (let i = 0; i < pages.length; i += 1) {
    pageIds.push(4 + i * 2);
    contentIds.push(5 + i * 2);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = [
      "BT",
      `/F1 ${PDF_FONT_SIZE} Tf`,
      `${PDF_MARGIN} 802 Td`,
      ...page.flatMap((line, lineIndex) => [lineIndex === 0 ? "" : "0 -17 Td", `<${pdfWinAnsiHex(line)}> Tj`]).filter(Boolean),
      "ET",
    ].join("\n");
    objects[contentId] = `<< /Length ${utf8(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = utf8(body).length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = utf8(body).length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return utf8(body);
}

const PNG_WIDTH = 1600;
const PNG_MARGIN = 48;
const PNG_LINE_HEIGHT = 30;
const PNG_MAX_HEIGHT = 32000;
const PNG_MAX_ROWS = 1000;
const PNG_TITLE_FONT = "700 32px Arial";
const PNG_TEXT_FONT = "400 16px Arial";
const PNG_BOLD_FONT = "700 16px Arial";
/** Largura útil da linha no PNG. */
export const PNG_TEXT_WIDTH = PNG_WIDTH - 2 * PNG_MARGIN;

export interface PngLine {
  text: string;
  font: string;
  color: string;
  y: number;
}

export interface PngLayout {
  width: number;
  height: number;
  lines: PngLine[];
}

/**
 * Posição de cada linha do PNG. Linhas longas (URL, metodologia, fontes) quebram dentro da largura
 * útil e a imagem cresce para caber todas; só as linhas da tabela podem ser limitadas, com aviso.
 */
export function layoutPng(report: ExportReport, measureChar: (char: string, font: string) => number): PngLayout {
  const lines: PngLine[] = [];
  const wrapped = (value: string, font: string) => wrapText(value, PNG_TEXT_WIDTH, (char) => measureChar(char, font));
  const title = wrapped(report.title, PNG_TITLE_FONT);
  title.forEach((part, index) => lines.push({ text: part, font: PNG_TITLE_FONT, color: "#111827", y: 58 + index * 40 }));
  let y = 58 + (title.length - 1) * 40 + 36;
  const add = (parts: string[], bold = false) => {
    for (const part of parts) {
      lines.push({ text: part, font: bold ? PNG_BOLD_FONT : PNG_TEXT_FONT, color: bold ? "#111827" : "#4b5563", y });
      y += PNG_LINE_HEIGHT;
    }
  };
  const line = (value: string) => add(wrapped(value, PNG_TEXT_FONT));
  if (report.subtitle) line(report.subtitle);
  report.metadata.forEach((item) => line(`${item.label}: ${item.value}`));
  line(`Gerado em: ${report.generatedAt}`);
  line(`URL: ${report.url}`);
  report.sources.forEach((source) => line(`Fonte: ${source}`));
  report.methodology.forEach((item) => line(`Metodologia: ${item}`));
  y += 10;
  add(wrapped(report.headers.join("  |  "), PNG_BOLD_FONT), true);
  let shown = 0;
  for (const row of report.rows.slice(0, PNG_MAX_ROWS)) {
    const parts = wrapped(row.map(text).join("  |  "), PNG_TEXT_FONT);
    // Reserva uma linha para o aviso de limite: a imagem nunca passa da altura máxima do canvas.
    if (y + (parts.length + 1) * PNG_LINE_HEIGHT > PNG_MAX_HEIGHT) break;
    add(parts);
    shown += 1;
  }
  if (shown < report.rows.length) line(`PNG limitado às primeiras ${shown} linhas; CSV/XLSX preservam todas as ${report.rows.length}.`);
  return { width: PNG_WIDTH, height: Math.max(900, y), lines };
}

export async function reportPng(report: ExportReport): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para exportar PNG.");
  const widths = new Map<string, number>();
  const layout = layoutPng(report, (char, font) => {
    const key = `${font}|${char}`;
    let width = widths.get(key);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(char).width;
      widths.set(key, width);
    }
    return width;
  });
  // Redimensionar o canvas zera o estado do contexto: fonte e cor são definidas de novo em cada linha.
  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const line of layout.lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, PNG_MARGIN, line.y);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG."))), "image/png");
  });
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function download(filename: string, data: string | Blob | ArrayBuffer, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type ExportFormat = "csv" | "xlsx" | "pdf" | "png";

export async function downloadReport(report: ExportReport, format: ExportFormat): Promise<void> {
  const base = exportFilename(report.filename);
  if (format === "csv") download(`${base}.csv`, reportCsv(report), "text/csv;charset=utf-8");
  else if (format === "xlsx") download(`${base}.xlsx`, bytesToArrayBuffer(reportXlsx(report)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  else if (format === "pdf") download(`${base}.pdf`, bytesToArrayBuffer(reportPdf(report)), "application/pdf");
  else download(`${base}.png`, await reportPng(report), "image/png");
}
