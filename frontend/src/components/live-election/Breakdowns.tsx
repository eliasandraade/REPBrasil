"use client";

import { useState } from "react";
import { byRemaining, candidateByKey, lastToTotalize, leadPpOf, leadVotesOf, REGION_LABEL, shareOf, votesOf } from "@/lib/live-election/derive";
import {
  formatInteger,
  formatPercent,
  formatPercentagePoints,
  formatSections,
  formatSectionsPct,
  formatTimestamp,
  formatVotes,
} from "@/lib/live-election/format";
import type { LiveCandidate, TerritoryResult } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";

function ShareCell({ territory, candidate }: Readonly<{ territory: TerritoryResult; candidate: LiveCandidate | undefined }>) {
  if (!candidate) return <td className="px-3 py-2 text-right">—</td>;
  const v = votesOf(territory, candidate.key);
  return (
    <td className="px-3 py-2 text-right">
      <span className="block font-semibold text-fg">{formatPercent(shareOf(territory, candidate.key))}</span>
      <span className="block text-micro text-fg-muted">{formatVotes(v?.votes)}</span>
    </td>
  );
}

/**
 * Regiões (seção 29) e exterior: agregação feita pela API com votos ABSOLUTOS (soma de votos / soma de válidos),
 * nunca média de percentuais das UFs.
 */
export function RegionBreakdown() {
  const regions = useLive((s) => s.states?.regions ?? null);
  const exterior = useLive((s) => s.states?.exterior ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  if (!regions || !candidates) return null;
  const [a, b] = candidates;
  const rows = exterior ? [...regions, exterior] : regions;
  return (
    <section aria-labelledby="live-regions" data-testid="live-regions">
      <SectionHeading
        id="live-regions"
        eyebrow="Regiões"
        title="Resultado por região"
        description="Soma dos votos das UFs de cada região (números absolutos). O exterior aparece em linha própria."
      />
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:hidden" data-testid="live-regions-list">
        {rows.map((r) => {
          const leader = candidateByKey(candidates, r.leaderKey);
          return (
            <li key={`${r.scope}-${r.code}`} className="px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm font-semibold text-fg">{r.region ? REGION_LABEL[r.region] : r.name}</span>
                <span className="text-micro text-fg-muted">{formatSectionsPct(r.sections.totalizedPct)} totalizado</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-body-sm">
                {[a, b].map((c) =>
                  c ? (
                    <span key={c.key} className="flex items-center gap-1.5 text-fg-soft">
                      <SlotSwatch slot={c.slot} className="h-2 w-2" />
                      <span className="tabular font-semibold text-fg">{formatPercent(shareOf(r, c.key))}</span>
                    </span>
                  ) : null,
                )}
              </div>
              <p className="mt-1 text-micro text-fg-muted">
                {leader ? `${leader.ballotName} à frente por ${formatPercentagePoints(leadPpOf(r))}` : (r.votes.valid ?? 0) > 0 ? "Empate" : "Sem votos totalizados"} ·
                comparecimento {formatPercent(r.electorate.turnoutPct)} · abstenção {formatPercent(r.electorate.abstentionPct)}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full min-w-[720px] text-body-sm">
          <caption className="sr-only">Resultado do 2º turno por região e no exterior</caption>
          <thead>
            <tr className="border-b border-line text-micro uppercase text-fg-muted">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Região
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {a?.ballotName ?? "A"}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {b?.ballotName ?? "B"}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Diferença
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Eleitorado
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Comparec.
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Abstenção
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Totalização
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const leader = candidateByKey(candidates, r.leaderKey);
              return (
                <tr key={`${r.scope}-${r.code}`} className="border-b border-line/60 last:border-b-0" data-testid="live-region-row">
                  <th scope="row" className="px-3 py-2 text-left">
                    <span className="block font-semibold text-fg">{r.region ? REGION_LABEL[r.region] : r.name}</span>
                    <span className="flex items-center gap-1 text-micro text-fg-muted">
                      {leader ? <SlotSwatch slot={leader.slot} className="h-2 w-2" /> : null}
                      {leader ? `${leader.ballotName} à frente` : (r.votes.valid ?? 0) > 0 ? "Empate" : "Sem votos totalizados"}
                      {r.coverage !== "complete" ? " · parcial" : ""}
                    </span>
                  </th>
                  <ShareCell territory={r} candidate={a} />
                  <ShareCell territory={r} candidate={b} />
                  <td className="px-3 py-2 text-right">
                    <span className="block font-semibold text-fg">{formatPercentagePoints(leadPpOf(r))}</span>
                    <span className="block text-micro text-fg-muted">{formatVotes(leadVotesOf(r))}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{formatInteger(r.electorate.total)}</td>
                  <td className="px-3 py-2 text-right">{formatPercent(r.electorate.turnoutPct)}</td>
                  <td className="px-3 py-2 text-right">{formatPercent(r.electorate.abstentionPct)}</td>
                  <td className="px-3 py-2 text-right">{formatSectionsPct(r.sections.totalizedPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** "Onde estão os votos restantes?" (seção 42): eleitorado de seções não totalizadas por UF. Não é previsão. */
export function RemainingVotesPanel() {
  const remaining = useLive((s) => s.states?.remaining ?? null);
  const [all, setAll] = useState(false);
  if (!remaining) return null;
  const sorted = byRemaining(remaining).filter((r) => (r.remainingUpperBound ?? 0) > 0);
  const max = Math.max(1, ...sorted.map((r) => r.remainingUpperBound ?? 0));
  const shown = all ? sorted : sorted.slice(0, 10);
  return (
    <section aria-labelledby="live-remaining" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-remaining">
      <h2 id="live-remaining" className="text-body-lg font-semibold text-fg">
        Onde estão os votos restantes?
      </h2>
      <p className="mt-1 text-body-sm text-fg-muted">
        Eleitores de seções ainda não totalizadas (e de seções não apuradas), por UF: onde ainda existe capacidade matemática de alteração do placar.
        Não é estimativa de votos futuros.
      </p>
      {sorted.length === 0 ? (
        <p className="mt-3 text-body-sm text-fg-muted">Não há eleitorado pendente nas UFs.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {shown.map((r) => (
            <li key={r.uf} className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-body-sm">
              <span className="font-semibold text-fg" title={r.name}>
                {r.uf}
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                <span className="live-bar block h-full rounded-full bg-fg-soft" style={{ width: `${((r.remainingUpperBound ?? 0) / max) * 100}%` }} />
              </span>
              <span className="tabular text-right text-fg-soft">
                {formatInteger(r.remainingUpperBound)} <span className="text-micro text-fg-muted">({formatPercent(r.shareOfRemaining, 1)})</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {sorted.length > 10 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="focus-ring mt-2 rounded text-body-sm font-medium text-accent-text hover:underline">
          {all ? "Mostrar só as 10 maiores" : `Mostrar todas (${sorted.length})`}
        </button>
      ) : null}
    </section>
  );
}

/** Últimas UFs a totalizar (seção 41). */
export function LastToTotalize() {
  const remaining = useLive((s) => s.states?.remaining ?? null);
  if (!remaining) return null;
  const rows = lastToTotalize(remaining);
  return (
    <section aria-labelledby="live-last-ufs" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-last-ufs">
      <h2 id="live-last-ufs" className="text-label uppercase text-fg-muted">
        Últimas UFs a totalizar
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body-sm text-fg-muted">Todas as UFs com totalização concluída ou ainda sem dados.</p>
      ) : (
        <table className="mt-2 w-full text-body-sm">
          <caption className="sr-only">UFs com menor percentual de seções totalizadas</caption>
          <thead>
            <tr className="text-micro uppercase text-fg-muted">
              <th scope="col" className="py-1 text-left font-medium">
                UF
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Seções rest.
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Eleitorado rest.
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                % tot.
              </th>
              <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">
                Atualização
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uf} className="border-t border-line/60">
                <th scope="row" className="py-1.5 text-left font-semibold text-fg" title={r.name}>
                  {r.uf}
                </th>
                <td className="py-1.5 text-right">{formatSections(r.sectionsRemaining)}</td>
                <td className="py-1.5 text-right">{formatInteger(r.electorateNotTotalized)}</td>
                <td className="py-1.5 text-right">{formatSectionsPct(r.totalizedPct)}</td>
                <td className="hidden py-1.5 text-right text-fg-muted sm:table-cell">{formatTimestamp(r.updatedAt, "time")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Resumo territorial (seção 80): UFs por candidatura; municípios só com cobertura completa. */
export function TerritorialSummaryCard() {
  const summary = useLive((s) => s.states?.summary ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  if (!summary || !candidates) return null;
  const m = summary.municipalities;
  return (
    <section aria-labelledby="live-territorial" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-territorial-summary">
      <h2 id="live-territorial" className="text-label uppercase text-fg-muted">
        Resumo territorial
      </h2>
      <ul className="mt-2 space-y-1.5 text-body-sm">
        {candidates.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg-soft">
              <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" /> UFs com {c.ballotName} à frente
            </span>
            <span className="tabular font-semibold text-fg">{formatInteger(summary.ufsLeading[c.key] ?? 0)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2">
          <span className="text-fg-soft">UFs em empate</span>
          <span className="tabular font-semibold text-fg">{formatInteger(summary.ufsTied)}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span className="text-fg-soft">UFs sem votos totalizados</span>
          <span className="tabular font-semibold text-fg">{formatInteger(summary.ufsWithoutVotes)}</span>
        </li>
      </ul>
      <div className="mt-3 border-t border-line pt-3 text-body-sm" data-testid="live-municipal-coverage">
        {m.complete && m.leading ? (
          <ul className="space-y-1.5">
            {candidates.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-fg-soft">
                  <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" /> Municípios com {c.ballotName} à frente
                </span>
                <span className="tabular font-semibold text-fg">{formatInteger(m.leading?.[c.key] ?? 0)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">
            Contagem de municípios por candidatura disponível só com a cobertura municipal completa. Resultados recebidos:{" "}
            <span className="tabular font-semibold text-fg-soft">
              {formatInteger(m.withData)} de {formatInteger(m.total)}
            </span>{" "}
            ({formatPercent(m.coveragePct, 1)}).
          </p>
        )}
      </div>
    </section>
  );
}
