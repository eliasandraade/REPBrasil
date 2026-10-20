import { DataState, RetryButton } from "@/components/ui/DataState";
import type { DataSourceItem, PoliticianDetail } from "@/lib/types";
import { Row, formatDate } from "../utils";

interface MetadataTabProps {
  politician: PoliticianDetail;
  sources: DataSourceItem[];
  sourcesState?: "pending" | "ready" | "error";
  onRetrySources?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function SourceCard({ source }: { source: DataSourceItem }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-fg-soft truncate">{source.name}</p>
          <p className="text-xs text-fg-muted">{source.organization}</p>
        </div>
        <span className="flex-shrink-0 inline-flex items-center gap-1 rounded border border-accent/20 bg-accent/8 px-2 py-0.5 text-[10px] font-medium text-accent-text">
          <span className="h-1 w-1 rounded-full bg-accent" />
          <span>Fonte pública oficial</span>
        </span>
      </div>

      {/* Metadata rows */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-fg-muted">Tipo</span>
          <p className="text-fg-muted">{source.sourceType}</p>
        </div>
        <div>
          <span className="text-fg-muted">Coletado em</span>
          <p className="text-fg-muted">{formatDate(source.collectedAt)}</p>
        </div>
        {source.fileSizeBytes != null && (
          <div>
            <span className="text-fg-muted">Tamanho</span>
            <p className="text-fg-muted">{formatBytes(source.fileSizeBytes)}</p>
          </div>
        )}
        {source.license && (
          <div>
            <span className="text-fg-muted">Licença</span>
            <p className="text-fg-muted">{source.license}</p>
          </div>
        )}
      </div>

      {/* SHA-256 */}
      {source.hash && (
        <div className="rounded-md border border-line bg-canvas px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            Integridade SHA-256
          </p>
          <details>
            <summary className="cursor-pointer select-none list-none text-xs text-fg-muted hover:text-fg-muted">
              <span className="font-mono text-fg-muted">
                {source.hash.slice(0, 10)}...{source.hash.slice(-6)}
              </span>
              <span className="ml-2 text-accent-text underline-offset-2 hover:underline text-[10px]">
                ver completo
              </span>
            </summary>
            <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-fg-muted">
              {source.hash}
            </p>
          </details>
        </div>
      )}

      {/* Download */}
      {source.originalUrl && (
        <a
          href={source.originalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text transition-colors hover:text-fg"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Download original (fonte oficial)
        </a>
      )}
    </div>
  );
}

export function MetadataTab({ politician, sources, sourcesState = "ready", onRetrySources }: MetadataTabProps) {
  return (
    <div className="space-y-6">
      {/* Rastreabilidade note */}
      <div className="flex items-start gap-2 rounded-lg border border-accent/15 bg-accent/5 px-4 py-3 text-xs text-fg-muted">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-accent-text" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Rastreabilidade é parte central do REPBrasil. Cada dado relevante deve apontar para uma fonte pública verificável.
      </div>

      {/* IDs externos */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          IDs externos
        </p>
        <div className="overflow-hidden rounded-lg border border-line">
          <Row label="TSE" value={politician.tseId} />
          <Row label="Câmara dos Deputados" value={politician.camaraId} />
          <Row label="Senado Federal" value={politician.senateId} />
        </div>
      </div>

      {/* Coleta */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Coleta e metodologia
        </p>
        <div className="overflow-hidden rounded-lg border border-line">
          <Row label="Registro criado em" value={formatDate(politician.createdAt)} />
          <Row label="Última atualização" value={formatDate(politician.sourceUpdatedAt)} />
          <Row label="Versão da metodologia" value="v0 — em desenvolvimento" />
        </div>
      </div>

      {/* Fontes */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Fontes do sistema
          </p>
          {sourcesState === "ready" && <span className="text-xs text-fg-muted">{sources.length} fonte{sources.length !== 1 ? "s" : ""}</span>}
        </div>
        <p className="mb-3 text-xs text-fg-muted">Bases oficiais usadas pelo REPBrasil. A lista não é filtrada por político.</p>

        {sourcesState === "pending" && <DataState kind="loading" title="Carregando as fontes" height="h-24" />}
        {sourcesState === "error" && (
          <DataState kind="error" title="Não foi possível carregar as fontes." action={onRetrySources ? <RetryButton onRetry={onRetrySources} /> : undefined}>
            Falha de comunicação não é ausência de fonte.
          </DataState>
        )}
        {sourcesState === "ready" && sources.length === 0 && (
          <div className="rounded-lg border border-line bg-subtle px-4 py-5 text-center">
            <p className="text-xs text-fg-muted">Nenhuma fonte de dados cadastrada no sistema até agora.</p>
          </div>
        )}
        {sourcesState === "ready" && sources.length > 0 && (
          <div className="space-y-3">
            {sources.map((source) => (
              <SourceCard key={source.name} source={source} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
