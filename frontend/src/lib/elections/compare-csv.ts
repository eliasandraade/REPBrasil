/**
 * Exportação da matriz de comparação em CSV, gerada no navegador a partir do que já está na tela (dados públicos
 * do TSE; nenhum dado pessoal além do nome de urna). Formato amigável ao Excel em português: separador ";",
 * vírgula decimal e BOM UTF-8. Ausência continua ausência: a célula leva o estado ("sem Boletim de Urna"), nunca 0.
 */
import { displayName } from "./format";
import { CELL_STATE_LABEL, electionLabel, LEVEL_LABEL, TERRITORY_COMPARABILITY_LABEL } from "./xray";
import type { CompareTerritory, ComparisonResponse, TerritoryLevel } from "./xray-types";

const SEP = ";";

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const decimal = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

export function compareTerritoryLabel(t: CompareTerritory, level: TerritoryLevel): string {
  if (level === "state") return t.uf;
  if (level === "municipality") return t.municipalityName ?? t.municipalityTseCode ?? t.uf;
  if (level === "zone") return `${t.municipalityName} · zona ${t.zone}`;
  if (level === "section") return `Zona ${t.zone} · seção ${t.section}`;
  return `${t.placeName ? displayName(t.placeName) : `Local ${t.placeCode}`} · zona ${t.zone}`;
}

export function comparisonCsv(data: ComparisonResponse, columns: ComparisonResponse["candidacies"], level: TerritoryLevel): string {
  const header = [
    LEVEL_LABEL[level],
    ...columns.flatMap((c) => {
      const who = `${displayName(c.ballotName)} (${displayName(c.contest.officeName)} ${electionLabel(c.contest.year, c.contest.round)})`;
      return [`${who} — votos`, `${who} — % dos válidos`];
    }),
    "Comparabilidade",
  ];
  const rows = data.territories.map((t) => [
    compareTerritoryLabel(t, level),
    ...columns.flatMap((c) => {
      const found = t.cells.find((x) => x.candidacyId === c.candidacyId);
      if (!found) return ["sem candidatura", ""];
      return [found.votes === null ? CELL_STATE_LABEL[found.state] : found.votes, decimal(found.share)];
    }),
    TERRITORY_COMPARABILITY_LABEL[t.comparability],
  ]);
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

/** Baixa um texto como arquivo (sem servidor). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
