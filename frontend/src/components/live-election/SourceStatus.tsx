"use client";

import { formatDuration, formatInteger, formatRate, formatRelativeTime, formatTimestamp, NA } from "@/lib/live-election/format";
import type { ConnectionStatus } from "@/lib/live-election/store";
import { useLive, useNow } from "./LiveContext";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  idle: "Iniciando",
  connecting: "Conectando",
  open: "Conectado ao REPBrasil",
  reconnecting: "Reconectando…",
  offline: "Sem conexão — mantendo a última atualização",
};

/**
 * Estado da fonte (seção 44), discreto: TSE ● atualizado · último arquivo · recebido pelo REPBrasil · atraso.
 * Problema de ingestão nunca é escondido: defasagem e falha aparecem com rótulo.
 */
export function SourceStatusLine() {
  const source = useLive((s) => s.summary?.source ?? null);
  const connection = useLive((s) => s.connection);
  const now = useNow(5000);
  if (!source) return null;
  const healthy = source.healthy && !source.stale;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-muted" data-testid="live-source-status">
      <span className="inline-flex items-center gap-1.5 font-semibold text-fg-soft">
        TSE
        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${healthy ? "bg-positive" : "bg-warn"}`} />
        <span>{healthy ? "atualizado" : source.stale ? "sem atualização recente" : "instável"}</span>
      </span>
      <span>
        Último arquivo: <span className="tabular text-fg-soft">{formatTimestamp(source.lastFileGeneratedAt)}</span>
      </span>
      <span>
        Recebido pelo REPBrasil: <span className="tabular text-fg-soft">{formatTimestamp(source.lastReceivedAt)}</span>
      </span>
      <span>
        Atraso: <span className="tabular text-fg-soft">{formatDuration(source.delaySeconds)}</span>
      </span>
      {now !== null ? (
        <span>
          Verificado <span className="tabular">{formatRelativeTime(source.lastCheckedAt, now)}</span>
        </span>
      ) : null}
      <span aria-live="polite">{CONNECTION_LABEL[connection]}</span>
      {source.stale && source.staleSince && now !== null ? (
        <span className="font-semibold text-warn" role="status">
          ⚠ Dados oficiais sem atualização há {Math.max(1, Math.round((now - Date.parse(source.staleSince)) / 60_000))} min
        </span>
      ) : null}
    </div>
  );
}

/** Velocidade recente da totalização (seção 39) e estimativa técnica de conclusão (seção 40). */
export function VelocityPanel() {
  const velocity = useLive((s) => s.summary?.velocity ?? null);
  if (!velocity) return null;
  return (
    <section aria-labelledby="live-velocity" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-velocity">
      <h2 id="live-velocity" className="text-label uppercase text-fg-muted">
        Ritmo recente da totalização
      </h2>
      <table className="mt-2 w-full text-body-sm">
        <caption className="sr-only">Ritmo da totalização nas últimas janelas de tempo</caption>
        <thead>
          <tr className="text-left text-micro uppercase text-fg-muted">
            <th scope="col" className="py-1 font-medium">
              Janela
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Votos/min
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Seções/min
            </th>
            <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">
              Eleitores/min
            </th>
          </tr>
        </thead>
        <tbody>
          {velocity.windows.map((w) => (
            <tr key={w.minutes} className="border-t border-line/70">
              <th scope="row" className="py-1.5 text-left font-medium text-fg-soft">
                {w.minutes} min
              </th>
              <td className="py-1.5 text-right">{w.samples > 1 ? formatRate(w.votesPerMinute) : NA}</td>
              <td className="py-1.5 text-right">{w.samples > 1 ? formatRate(w.sectionsPerMinute) : NA}</td>
              <td className="hidden py-1.5 text-right sm:table-cell">{w.samples > 1 ? formatRate(w.electoratePerMinute) : NA}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {velocity.eta ? (
        <p className="mt-3 text-body-sm text-fg-soft" data-testid="live-eta">
          Estimativa técnica de conclusão da totalização:{" "}
          <span className="tabular font-semibold text-fg">{formatTimestamp(velocity.eta.at, "time")}</span>{" "}
          <span className="text-micro text-fg-muted">(base: ritmo dos últimos {formatInteger(velocity.eta.basisMinutes)} min)</span>
        </p>
      ) : null}
      <p className="mt-2 text-micro text-fg-muted">
        Estatística operacional do ritmo de chegada dos dados. Não indica resultado nem horário de definição de candidatura.
      </p>
    </section>
  );
}
