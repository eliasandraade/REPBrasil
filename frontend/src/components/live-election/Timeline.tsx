"use client";

import { formatSectionsPct, formatTimestamp } from "@/lib/live-election/format";
import { useLive } from "./LiveContext";

/** Linha do tempo editorial (seção 79): só marcos reais registrados a partir dos arquivos oficiais. */
export function ElectionTimeline() {
  const events = useLive((s) => s.summary?.events ?? null);
  if (!events) return null;
  return (
    <section aria-labelledby="live-milestones" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-milestones">
      <h2 id="live-milestones" className="text-label uppercase text-fg-muted">
        Marcos da apuração
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-body-sm text-fg-muted">Os marcos aparecem aqui conforme acontecem.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[4.5rem_1fr] gap-2 text-body-sm">
              <span className="tabular font-semibold text-fg">{formatTimestamp(e.at ?? e.detectedAt, "time")}</span>
              <span className="min-w-0">
                <span className="text-fg">{e.title}</span>
                {e.sectionsPct !== null ? <span className="text-micro text-fg-muted"> · {formatSectionsPct(e.sectionsPct)} das seções</span> : null}
                {e.detail ? <span className="block text-micro text-fg-muted">{e.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
