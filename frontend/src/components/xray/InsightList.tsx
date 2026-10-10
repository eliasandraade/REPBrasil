import type { Insight } from "@/lib/elections/xray-types";

/** Insights determinísticos: o texto vem da API (dados → métrica → template); nada é gerado no cliente. */
export function InsightList({ insights, max }: Readonly<{ insights: Insight[]; max?: number }>) {
  const shown = max ? insights.slice(0, max) : insights;
  if (shown.length === 0) return null;
  return (
    <ul className="mb-3 space-y-1.5" data-testid="insight-list">
      {shown.map((insight) => (
        <li
          key={`${insight.code}|${insight.text}`}
          data-insight={insight.code}
          className="rounded-md border border-white/8 bg-card px-3 py-2 text-xs leading-relaxed text-slate-300"
        >
          {insight.text}
        </li>
      ))}
    </ul>
  );
}
