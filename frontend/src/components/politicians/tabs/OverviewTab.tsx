import type { AssetDeclarationItem, ElectionResultItem, PoliticianDetail } from "@/lib/types";
import { formatCurrency, formatStatus, Row } from "../utils";

interface OverviewTabProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-card-elevated px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-1 truncate text-base font-bold text-slate-200">{value}</p>
    </div>
  );
}

export function OverviewTab({ politician, elections, assets }: OverviewTabProps) {
  const partyLabel = [politician.partyAcronym, politician.partyName]
    .filter(Boolean)
    .join(" — ");

  const maxVotes = elections.length > 0
    ? Math.max(...elections.map((e) => e.totalVotes))
    : 0;
  const latestAssets = assets[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Summary mini cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniCard
          label="Candidaturas"
          value={elections.length > 0 ? String(elections.length) : "—"}
        />
        <MiniCard
          label="Maior votação"
          value={maxVotes > 0 ? maxVotes.toLocaleString("pt-BR") : "—"}
        />
        <MiniCard
          label="Patrimônio declarado"
          value={latestAssets ? formatCurrency(latestAssets.totalValue) : "—"}
        />
        <MiniCard
          label="Itens declarados"
          value={latestAssets ? String(latestAssets.items.length) : "—"}
        />
      </div>

      {/* Electoral data */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Dados eleitorais — TSE 2024
        </p>
        <div className="overflow-hidden rounded-lg border border-white/[0.08]">
          <Row label="Cargo" value={politician.office} />
          <Row label="Partido" value={partyLabel || null} />
          <Row label="UF" value={politician.state} />
          <Row label="Situação da candidatura" value={formatStatus(politician.candidacyStatus)} />
        </div>
      </div>

      {/* Data integrity note */}
      <div className="flex items-start gap-2 rounded-md border border-white/[0.08] bg-card-elevated px-3 py-2.5 text-xs text-slate-500">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-slate-600" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
        Dados provenientes de bases públicas oficiais do TSE. Sujeitos a limitações e inconsistências nas fontes originais.
      </div>
    </div>
  );
}
