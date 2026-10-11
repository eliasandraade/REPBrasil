import type { ElectionResultItem } from "@/lib/types";
import { formatStatus } from "../utils";

interface ElectionTabProps {
  elections: ElectionResultItem[];
}

export function ElectionTab({ elections }: ElectionTabProps) {
  if (elections.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-subtle px-5 py-10 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-fg-muted" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <p className="font-medium text-fg-muted">Resultados eleitorais não encontrados</p>
        <p className="mt-1 max-w-xs mx-auto text-xs text-fg-muted">
          Resultados eleitorais ainda não encontrados para este agente político na base inicial.
          A base está em expansão progressiva.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Histórico eleitoral — TSE
      </p>
      <div className="overflow-hidden rounded-lg border border-line">
        {elections.map((e, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5 last:border-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-fg-soft">{e.year}</span>
                {e.round > 1 && (
                  <span className="rounded border border-line bg-fg/5 px-1.5 py-0.5 text-[10px] text-fg-muted">
                    {e.round}º turno
                  </span>
                )}
                {e.elected && (
                  <span className="rounded border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">
                    Eleito(a)
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-fg-muted truncate">
                {e.office}
                {e.city ? ` · ${e.city}, ${e.state}` : ` · ${e.state}`}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-semibold text-fg-soft">
                {e.totalVotes.toLocaleString("pt-BR")}
                <span className="ml-1 text-xs font-normal text-fg-muted">votos</span>
              </p>
              {e.situation && (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {formatStatus(e.situation)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
