import { useState } from "react";
import type { AssetDeclarationItem, ElectionResultItem, PoliticianDetail } from "@/lib/types";

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
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

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatStatus(status: string | null): string {
  if (!status || status === "#NE") return "—";
  return status
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function PoliticianProfile({ politician, elections, assets }: PoliticianProfileProps) {
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

      {/* Patrimônio declarado */}
      {assets.length > 0 && (
        <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Patrimônio declarado — TSE
            </p>
          </div>
          {(() => {
            const maxTotal = Math.max(...assets.map((a) => a.totalValue), 1);
            return assets.map((decl, idx) => {
              const prev = assets[idx + 1];
              const yoyPct =
                prev && prev.totalValue > 0 && prev.year !== decl.year
                  ? ((decl.totalValue - prev.totalValue) / prev.totalValue) * 100
                  : null;
              const barPct = Math.round((decl.totalValue / maxTotal) * 100);

              return (
                <div key={decl.year} className="px-4 py-4 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-slate-900">{decl.year}</p>
                    <p className="text-sm font-medium text-slate-900">
                      {formatCurrency(decl.totalValue)}
                    </p>
                  </div>

                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-400 rounded-full"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>

                  {yoyPct !== null && (
                    <p className="text-xs text-slate-400">
                      Variação percentual em relação à declaração anterior:{" "}
                      {yoyPct >= 0 ? "+" : ""}
                      {yoyPct.toFixed(1)}%
                    </p>
                  )}

                  {decl.items.length > 0 && (
                    <AssetItemList items={decl.items} />
                  )}
                </div>
              );
            });
          })()}
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

const ITEMS_DEFAULT_LIMIT = 10;

function AssetItemList({ items }: { items: AssetDeclarationItem["items"] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, ITEMS_DEFAULT_LIMIT);
  const hidden = items.length - ITEMS_DEFAULT_LIMIT;

  return (
    <div className="divide-y divide-slate-50 border border-slate-100 rounded-md">
      {visible.map((item) => (
        <div
          key={item.order}
          className="px-3 py-2 flex items-start justify-between gap-3 text-xs"
        >
          <div className="min-w-0">
            <p className="text-slate-500 truncate">
              {item.typeDescription ?? "Bem não especificado"}
            </p>
            {item.description && (
              <p className="text-slate-400 truncate mt-0.5">{item.description}</p>
            )}
          </div>
          <p className="text-slate-700 font-medium shrink-0">
            {formatCurrency(item.value)}
          </p>
        </div>
      ))}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-2 text-xs text-slate-400 hover:text-slate-600 text-center"
        >
          Ver todos os {items.length} bens
        </button>
      )}
    </div>
  );
}
