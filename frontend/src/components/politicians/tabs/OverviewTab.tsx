import type { AssetDeclarationItem, ElectionResultItem, PoliticianDetail } from "@/lib/types";
import { formatCurrency, formatStatus, Row } from "../utils";

interface OverviewTabProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-lg px-4 py-3">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-slate-900 mt-1 truncate">{value}</p>
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
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Candidaturas"
          value={elections.length > 0 ? String(elections.length) : "—"}
        />
        <SummaryCard
          label="Maior votação registrada"
          value={maxVotes > 0 ? maxVotes.toLocaleString("pt-BR") : "—"}
        />
        <SummaryCard
          label="Patrimônio declarado"
          value={latestAssets ? formatCurrency(latestAssets.totalValue) : "—"}
        />
        <SummaryCard
          label="Bens declarados"
          value={latestAssets ? String(latestAssets.items.length) : "—"}
        />
      </div>

      {/* Dados eleitorais */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Dados eleitorais — TSE 2024
          </p>
        </div>
        <Row label="Cargo" value={politician.office} />
        <Row label="Partido" value={partyLabel || null} />
        <Row label="UF" value={politician.state} />
        <Row label="Situação da candidatura" value={formatStatus(politician.candidacyStatus)} />
      </section>
    </div>
  );
}
