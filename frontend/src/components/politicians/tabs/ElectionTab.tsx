import type { ElectionResultItem } from "@/lib/types";
import { formatStatus } from "../utils";

interface ElectionTabProps {
  elections: ElectionResultItem[];
}

export function ElectionTab({ elections }: ElectionTabProps) {
  if (elections.length === 0) {
    return (
      <p className="text-slate-400 text-sm py-6 text-center">
        Nenhum resultado eleitoral registrado.
      </p>
    );
  }

  return (
    <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          Histórico eleitoral
        </p>
      </div>
      {elections.map((e, i) => (
        <div key={i} className="px-4 py-3 flex items-start justify-between text-sm gap-4">
          <div className="min-w-0">
            <p className="text-slate-900 font-medium">
              {e.year}
              {e.round > 1 && (
                <span className="text-slate-400 font-normal ml-1">— {e.round}º turno</span>
              )}
            </p>
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              {e.office}
              {e.city ? ` · ${e.city}, ${e.state}` : ` · ${e.state}`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-slate-900 font-medium">
              {e.totalVotes.toLocaleString("pt-BR")} votos
            </p>
            {e.situation && (
              <p className="text-xs mt-0.5 text-slate-500">
                {formatStatus(e.situation)}
              </p>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
