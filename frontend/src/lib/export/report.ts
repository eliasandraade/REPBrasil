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

function safeFilename(value: string): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "repbrasil-export";
}

function text(value: ReportValue): string {
  return value === null ? "—" : String(value);
}

function csvCell(value: ReportValue): string {
  const raw = text(value);
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
    result = String.fromCharCode(65 + (n % 26)) + result;
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
          if (value === null) return "";
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xml(String(value))}</t></is></c>`;
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
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length),
      u16(name.length), u16(0), name, entry.data,
    ]);
    body.push(local);
    directory.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length),
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

function pdfEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll(/[^\x20-\x7E]/g, "?");
}

function wrap(value: string, width = 92): string[] {
  if (value.length <= width) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
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
  ].flatMap((line) => wrap(line));

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
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = ["BT", "/F1 9 Tf", "42 802 Td", ...page.flatMap((line, lineIndex) => [lineIndex === 0 ? "" : "0 -17 Td", `(${pdfEscape(line)}) Tj`]).filter(Boolean), "ET"].join("\n");
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

export async function reportPng(report: ExportReport): Promise<Blob> {
  const maxRows = 1000;
  const rows = report.rows.slice(0, maxRows);
  const width = 1600;
  const lineHeight = 30;
  const contextLines = report.metadata.length + report.sources.length + report.methodology.length + 8;
  const height = Math.max(900, Math.min(32000, 180 + (contextLines + rows.length + 2) * lineHeight));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para exportar PNG.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.font = "700 32px Arial";
  ctx.fillText(report.title, 48, 58);
  ctx.font = "16px Arial";
  let y = 94;
  const line = (value: string, bold = false) => {
    ctx.font = `${bold ? "700" : "400"} 16px Arial`;
    ctx.fillStyle = bold ? "#111827" : "#4b5563";
    ctx.fillText(value.slice(0, 180), 48, y);
    y += lineHeight;
  };
  if (report.subtitle) line(report.subtitle);
  report.metadata.forEach((item) => line(`${item.label}: ${item.value}`));
  line(`Gerado em: ${report.generatedAt}`);
  line(`URL: ${report.url}`);
  report.sources.forEach((source) => line(`Fonte: ${source}`));
  report.methodology.forEach((item) => line(`Metodologia: ${item}`));
  y += 10;
  line(report.headers.join("  |  "), true);
  rows.forEach((row) => line(row.map(text).join("  |  ")));
  if (report.rows.length > maxRows) line(`PNG limitado às primeiras ${maxRows} linhas; CSV/XLSX preservam todas as ${report.rows.length}.`);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG."))), "image/png");
  });
}

function download(filename: string, data: BlobPart, type: string) {
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
  const base = safeFilename(report.filename);
  if (format === "csv") download(`${base}.csv`, reportCsv(report), "text/csv;charset=utf-8");
  else if (format === "xlsx") download(`${base}.xlsx`, reportXlsx(report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  else if (format === "pdf") download(`${base}.pdf`, reportPdf(report), "application/pdf");
  else download(`${base}.png`, await reportPng(report), "image/png");
}
