import type { DataSourceItem, PoliticianDetail } from "@/lib/types";
import { Row, formatDate } from "../utils";

interface MetadataTabProps {
  politician: PoliticianDetail;
  sources: DataSourceItem[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function MetadataTab({ politician, sources }: MetadataTabProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        IDs externos
      </p>
      <Row label="TSE" value={politician.tseId} />
      <Row label="Câmara" value={politician.camaraId} />
      <Row label="Senado" value={politician.senateId} />

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-6 mb-2">
        Coleta de dados
      </p>
      <Row label="Cadastro criado em" value={formatDate(politician.createdAt)} />
      <Row label="Última atualização" value={formatDate(politician.sourceUpdatedAt)} />
      <Row label="Versão da metodologia" value="v0 — em desenvolvimento" />

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-6 mb-2">
        Origem dos dados
      </p>
      {sources.length === 0 ? (
        <div className="bg-slate-50 rounded p-3">
          <p className="text-xs text-slate-500">
            Dados atualmente baseados em datasets eleitorais públicos do TSE.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div key={source.name} className="bg-slate-50 rounded p-3 space-y-1">
              <p className="text-xs font-medium text-slate-700">{source.name}</p>
              <p className="text-xs text-slate-500">{source.organization}</p>
              <p className="text-xs text-slate-400">
                Coletado em: {formatDate(source.collectedAt)}
              </p>
              {source.fileSizeBytes != null && (
                <p className="text-xs text-slate-400">
                  Tamanho: {formatBytes(source.fileSizeBytes)}
                </p>
              )}
              {source.license && (
                <p className="text-xs text-slate-400">Licença: {source.license}</p>
              )}
              {source.hash && (
                <details className="text-xs">
                  <summary className="text-slate-400 cursor-pointer list-none select-none">
                    SHA-256:{" "}
                    <span className="font-mono">
                      {source.hash.slice(0, 8)}...{source.hash.slice(-4)}
                    </span>
                    <span className="underline ml-2">ver completo</span>
                  </summary>
                  <p className="text-slate-300 font-mono break-all mt-1 leading-relaxed">
                    {source.hash}
                  </p>
                </details>
              )}
              {source.originalUrl ? (
                <a
                  href={source.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-xs text-slate-400 underline block"
                >
                  Download original
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
