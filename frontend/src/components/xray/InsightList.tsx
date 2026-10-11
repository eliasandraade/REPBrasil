import type { Insight } from "@/lib/elections/xray-types";

/**
 * Insights determinísticos: o texto vem da API (dados → métrica → template); nada é gerado no cliente.
 * `prominent`: leitura principal da visão geral do perfil (maior, com marcador), não um rodapé.
 */
export function InsightList({ insights, max, prominent = false }: Readonly<{ insights: Insight[]; max?: number; prominent?: boolean }>) {
  const shown = max ? insights.slice(0, max) : insights;
  if (shown.length === 0) return null;
  return (
    <ul className={prominent ? "space-y-2" : "mb-3 space-y-1.5"} data-testid="insight-list">
      {shown.map((insight) => (
        <li
          key={`${insight.code}|${insight.text}`}
          data-insight={insight.code}
          className={
            prominent
              ? "rounded-md border border-line border-l-2 border-l-brand/60 bg-surface px-4 py-3 text-sm leading-relaxed text-fg-soft"
              : "rounded-md border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-fg-soft"
          }
        >
          {insight.text}
        </li>
      ))}
    </ul>
  );
}
