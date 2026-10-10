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
              ? "rounded-md border border-white/8 border-l-2 border-l-brand/60 bg-card px-4 py-3 text-sm leading-relaxed text-slate-200"
              : "rounded-md border border-white/8 bg-card px-3 py-2 text-xs leading-relaxed text-slate-300"
          }
        >
          {insight.text}
        </li>
      ))}
    </ul>
  );
}
