import type { ElectionResultItem, PoliticianDetail } from "@/lib/types";

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatStatus(status: string | null): string {
  if (!status || status === "#NE") return "—";
  return status
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function PoliticianProfile({ politician, elections }: PoliticianProfileProps) {
  const partyLabel = [politician.partyAcronym, politician.partyName]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="space-y-8">
      {/* Identidade */}
      <section className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">{politician.ballotName}</h1>
        <p className="text-lg text-slate-500">{politician.name}</p>
      </section>

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

      {/* Histórico eleitoral */}
      {elections.length > 0 && (
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
      )}

      {/* IDs externos */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Identificadores externos
          </p>
        </div>
        <Row label="ID TSE" value={politician.tseId} />
        <Row label="ID Câmara" value={politician.camaraId} />
        <Row label="ID Senado" value={politician.senateId} />
      </section>

      {/* Metadados */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Dados de coleta
          </p>
        </div>
        <Row label="Dados coletados em" value={formatDate(politician.sourceUpdatedAt)} />
        <Row label="Registrado em" value={formatDate(politician.createdAt)} />
      </section>

      {/* Score — placeholder */}
      <section className="border border-dashed border-slate-300 rounded-lg p-6 text-center">
        <p className="text-slate-400 text-sm font-medium">Score Público de Transparência</p>
        <p className="text-slate-300 text-4xl font-bold mt-1">—</p>
        <p className="text-slate-400 text-xs mt-2">
          Disponível quando votações e gastos forem integrados.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="px-4 py-3 flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value ?? "—"}</span>
    </div>
  );
}
