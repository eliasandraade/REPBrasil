import type { ExportReport, ReportValue } from "@/lib/export/report";
import { displayName } from "./format";
import { CELL_STATE_LABEL, electionLabel, LEVEL_LABEL, TERRITORY_COMPARABILITY_LABEL } from "./xray";
import type { ComparisonResponse, TerritoryLevel } from "./xray-types";
import { compareTerritoryLabel } from "./compare-csv";

function number(value: number | null): ReportValue {
  return value === null ? null : value;
}

export function candidacyComparisonReport(
  data: ComparisonResponse,
  columns: ComparisonResponse["candidacies"],
  level: TerritoryLevel,
  url: string,
): ExportReport {
  const headers = [
    LEVEL_LABEL[level],
    ...columns.flatMap((candidate) => {
      const label = `${displayName(candidate.ballotName)} · ${electionLabel(candidate.contest.year, candidate.contest.round)}`;
      return [`${label} — votos`, `${label} — % válidos`];
    }),
    "Comparabilidade",
  ];
  const rows = data.territories.map((territory) => [
    compareTerritoryLabel(territory, level),
    ...columns.flatMap((candidate) => {
      const cell = territory.cells.find((item) => item.candidacyId === candidate.candidacyId);
      if (!cell) return ["Sem candidatura", null];
      return [cell.votes === null ? CELL_STATE_LABEL[cell.state] : number(cell.votes), number(cell.share)];
    }),
    TERRITORY_COMPARABILITY_LABEL[territory.comparability],
  ]);

  return {
    filename: `repbrasil-comparacao-candidaturas-${level}`,
    title: "REPBrasil — Comparação de candidaturas",
    subtitle: columns.map((candidate) => displayName(candidate.ballotName)).join(" × "),
    headers,
    rows,
    metadata: [
      { label: "Nível territorial", value: LEVEL_LABEL[level] },
      { label: "UF", value: data.uf },
      { label: "Candidaturas", value: String(columns.length) },
      { label: "Territórios", value: String(data.territories.length) },
      { label: "Atualização", value: data.freshness.refreshedAt ?? "Não informada" },
    ],
    sources: ["Tribunal Superior Eleitoral (TSE) — Boletins de Urna e dados oficiais importados pelo REPBrasil"],
    methodology: [
      "Ausência de dado permanece ausência e nunca é convertida em zero.",
      "Comparações entre eleições só são interpretadas quando a API marca disputa e território como comparáveis.",
      "Insights exibidos pelo produto são determinísticos e não usam IA generativa para produzir conclusões factuais.",
    ],
    generatedAt: new Date().toISOString(),
    url,
  };
}
