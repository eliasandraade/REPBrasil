"use client";

import { leadPpOf, leadVotesOf, shareOf, votesOf } from "@/lib/live-election/derive";
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
import { MetricRow, ProgressBar, SlotSwatch } from "./primitives";

/** Votos e percentuais de cada candidatura num território, com barra proporcional. */
export function CandidateSplit({ territory, candidates }: Readonly<{ territory: TerritoryResult; candidates: readonly LiveCandidate[] }>) {
  const [a, b] = candidates;
  const pa = a ? shareOf(territory, a.key) : null;
  const pb = b ? shareOf(territory, b.key) : null;
  const total = (pa ?? 0) + (pb ?? 0);
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-2 gap-3">
        {candidates.map((c) => {
          const v = votesOf(territory, c.key);
          return (
            <li key={c.key} className="min-w-0 rounded-xl border border-line bg-surface p-3">
              <p className="flex items-center gap-1.5 truncate text-body-sm text-fg-soft">
                <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" />
                {c.ballotName}
              </p>
              <p className="tabular mt-1 text-heading-sm font-bold text-fg">{formatPercent(shareOf(territory, c.key))}</p>
              <p className="tabular text-micro text-fg-muted">{formatVotes(v?.votes)} votos</p>
            </li>
          );
        })}
      </ul>
      {total > 0 && pa !== null ? (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-subtle" aria-hidden="true">
          <div className="live-bar live-fill-a h-full" style={{ width: `${(pa / total) * 100}%` }} />
          <div className="live-bar live-fill-b live-hatch h-full flex-1" />
        </div>
      ) : null}
      <p className="text-body-sm text-fg-soft">
        Diferença: <span className="tabular font-semibold text-fg">{formatPercentagePoints(leadPpOf(territory))}</span> ·{" "}
        <span className="tabular font-semibold text-fg">{formatVotes(leadVotesOf(territory))}</span> votos
      </p>
    </div>
  );
}

/** Ficha completa de um território (UF, município, zona): resultado, participação, votos e seções. */
export function TerritoryDetail({ territory, candidates }: Readonly<{ territory: TerritoryResult; candidates: readonly LiveCandidate[] }>) {
  if (!territory.available) {
    return <p className="text-body-sm text-fg-muted">O arquivo oficial desta abrangência ainda não foi recebido pelo REPBrasil.</p>;
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-2 text-body-sm">
          <span className="text-fg-muted">Seções totalizadas</span>
          <span className="tabular font-semibold text-fg">{formatSectionsPct(territory.sections.totalizedPct)}</span>
        </div>
        <ProgressBar pct={territory.sections.totalizedPct} label={`Seções totalizadas em ${territory.name}`} className="mt-1 h-1.5" />
        <p className="mt-1 text-micro text-fg-muted">
          Totalização às {formatTimestamp(territory.totalizedAt)} · recebido às {formatTimestamp(territory.ingestedAt)}
          {territory.coverage !== "complete" ? ` · dado ${territory.coverage === "stale" ? "defasado" : "parcial"}` : ""}
        </p>
      </div>
      <CandidateSplit territory={territory} candidates={candidates} />
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <MetricRow label="Eleitorado" value={formatInteger(territory.electorate.total)} />
        <MetricRow label="Comparecimento" value={formatInteger(territory.electorate.turnout)} extra={formatPercent(territory.electorate.turnoutPct)} />
        <MetricRow label="Abstenção" value={formatInteger(territory.electorate.abstention)} extra={formatPercent(territory.electorate.abstentionPct)} />
        <MetricRow label="Votos válidos" value={formatVotes(territory.votes.valid)} extra={formatPercent(territory.votes.validPct)} />
        <MetricRow label="Brancos" value={formatVotes(territory.votes.blank)} extra={formatPercent(territory.votes.blankPct)} />
        <MetricRow label="Nulos" value={formatVotes(territory.votes.nullTotal)} extra={formatPercent(territory.votes.nullTotalPct)} />
        <MetricRow label="Seções" value={formatSections(territory.sections.total)} />
        <MetricRow label="Seções totalizadas" value={formatSections(territory.sections.totalized)} />
      </dl>
    </div>
  );
}
