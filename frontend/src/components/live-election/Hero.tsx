"use client";

import { votesOf } from "@/lib/live-election/derive";
import {
  formatPercent,
  formatPercentExact,
  formatSectionsPct,
  formatTimestamp,
  formatVotes,
} from "@/lib/live-election/format";
import { isFinal, PHASE_HEADLINE, showsResults } from "@/lib/live-election/phase";
import type { LiveCandidate, LiveMeta, LiveSummary } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { CandidatePhoto, FlashValue, ModeBadge, ProgressBar, SlotSwatch, StatusPill } from "./primitives";

function coalitionLine(c: LiveCandidate): string | null {
  if (!c.coalition) return null;
  const kind = c.coalition.kind === "coligacao" ? "Coligação" : c.coalition.kind === "federacao" ? "Federação" : null;
  if (!kind) return null;
  return `${kind} ${c.coalition.name}`;
}

function CandidateScoreCard({
  candidate,
  summary,
  results,
  align,
}: Readonly<{ candidate: LiveCandidate; summary: LiveSummary; results: boolean; align: "start" | "end" }>) {
  const v = votesOf(summary.national, candidate.key);
  const leading = results && summary.national.leaderKey === candidate.key;
  const final = isFinal(summary);
  const coalition = coalitionLine(candidate);
  const textAlign = align === "end" ? "xl:text-right xl:items-end" : "xl:items-start";
  return (
    <article
      aria-label={`${candidate.ballotName}, número ${candidate.number}${candidate.party ? `, ${candidate.party}` : ""}`}
      data-testid={`live-candidate-${candidate.slot}`}
      className={`flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:p-5 ${textAlign}`}
    >
      <div className={`flex flex-col items-start gap-2 xl:flex-row xl:gap-4 ${align === "end" ? "xl:flex-row-reverse xl:items-start" : ""}`}>
        <div className="hidden sm:block">
          <CandidatePhoto candidate={candidate} size={96} priority />
        </div>
        <div className="sm:hidden">
          <CandidatePhoto candidate={candidate} size={48} priority />
        </div>
        <div className={`min-w-0 flex-1 ${align === "end" ? "xl:text-right" : ""}`}>
          <div className={`flex items-center gap-2 ${align === "end" ? "xl:justify-end" : ""}`}>
            <SlotSwatch slot={candidate.slot} />
            <span className="text-label uppercase text-fg-muted">
              {candidate.number}
              {candidate.party ? ` · ${candidate.party}` : ""}
            </span>
          </div>
          <h3 className="mt-1 text-body-md font-bold leading-tight text-fg [overflow-wrap:break-word] sm:text-heading-sm xl:text-heading-md">{candidate.ballotName}</h3>
          {coalition ? <p className="mt-1 hidden text-micro text-fg-muted sm:block">{coalition}</p> : null}
          {candidate.vice ? (
            <p className="mt-0.5 hidden text-micro text-fg-muted sm:block">
              Vice: {candidate.vice.ballotName}
              {candidate.vice.party ? ` (${candidate.vice.party})` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {results ? (
        <div className={`flex flex-col ${align === "end" ? "xl:items-end" : ""}`}>
          <p
            className="tabular text-heading-lg font-bold leading-none text-fg sm:text-display-lg"
            title={`Percentual oficial: ${formatPercentExact(v?.pct)}`}
            data-testid={`live-candidate-${candidate.slot}-pct`}
          >
            <FlashValue value={v?.pct}>{formatPercent(v?.pct)}</FlashValue>
          </p>
          <p className="tabular mt-1 text-body-sm text-fg-soft">
            <FlashValue value={v?.votes}>{formatVotes(v?.votes)}</FlashValue> votos
          </p>
          <div className={`mt-2 flex flex-wrap gap-2 ${align === "end" ? "xl:justify-end" : ""}`}>
            {final && candidate.situation ? (
              <span className="rounded-md border border-line bg-subtle px-2 py-0.5 text-label uppercase text-fg-soft" data-testid="live-candidate-situation">
                {candidate.situation}
              </span>
            ) : leading ? (
              <span className="rounded-md border border-line bg-subtle px-2 py-0.5 text-label uppercase text-fg-soft">À frente</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-body-sm text-fg-muted">Aguardando a totalização oficial</p>
      )}
    </article>
  );
}

/** Barra proporcional A | B pelos percentuais oficiais, com a marca de 50%. */
function ProportionalBar({ summary }: Readonly<{ summary: LiveSummary }>) {
  const [a, b] = summary.candidates;
  if (!a || !b) return null;
  const pa = votesOf(summary.national, a.key)?.pct ?? null;
  const pb = votesOf(summary.national, b.key)?.pct ?? null;
  if (pa === null || pb === null || pa + pb <= 0) return null;
  const wa = (pa / (pa + pb)) * 100;
  return (
    <div className="mt-4" data-testid="live-proportional-bar">
      <div
        className="relative flex h-3 w-full overflow-hidden rounded-full bg-subtle sm:h-4"
        role="img"
        aria-label={`${a.ballotName} ${formatPercent(pa)}; ${b.ballotName} ${formatPercent(pb)} dos votos válidos`}
      >
        <div className="live-bar live-fill-a h-full" style={{ width: `${wa}%` }} />
        <div className="live-bar live-fill-b live-hatch h-full flex-1" />
        <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-canvas" />
      </div>
      <div className="mt-1 flex justify-between text-micro text-fg-muted">
        <span>{a.ballotName}</span>
        <span>50%</span>
        <span>{b.ballotName}</span>
      </div>
    </div>
  );
}

function Totalization({ summary, meta }: Readonly<{ summary: LiveSummary; meta: LiveMeta | null }>) {
  const pct = summary.national.sections.totalizedPct;
  return (
    <div className="flex flex-col gap-2" data-testid="live-totalization">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label uppercase text-fg-muted">Seções totalizadas</span>
        <span className="tabular text-heading-sm font-bold text-fg" data-testid="live-sections-pct">
          <FlashValue value={pct}>{formatSectionsPct(pct)}</FlashValue>
        </span>
      </div>
      <ProgressBar pct={pct} label="Seções totalizadas" />
      <p className="text-micro text-fg-muted">
        Fonte: TSE · totalização às {formatTimestamp(meta?.totalizedAt ?? summary.national.totalizedAt)}
      </p>
    </div>
  );
}

/** Topo da página: estado, candidatos, percentuais e totalização (nível 1 — leitura instantânea). */
export function Hero() {
  const summary = useLive((s) => s.summary);
  const meta = useLive((s) => s.summaryMeta);
  if (!summary) return null;
  const results = showsResults(summary);
  const [a, b] = summary.candidates;
  const updated = formatTimestamp(meta?.totalizedAt ?? summary.national.totalizedAt);

  return (
    <section aria-labelledby="live-hero-title" className="rounded-3xl border border-line bg-canvas/60 p-2 sm:p-4" data-testid="live-hero">
      {/* Celular: estado primeiro */}
      <div className="flex flex-wrap items-center gap-2 px-1 pb-3 xl:hidden">
        <StatusPill phase={summary.phase} />
        {meta ? <ModeBadge mode={meta.mode} /> : null}
        <span className="text-micro text-fg-muted">Atualizado às {updated}</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(240px,300px)_minmax(0,1fr)] xl:gap-5">
        <div className="grid grid-cols-2 gap-3 xl:contents">
          {a ? (
            <div className="h-full min-w-0 xl:order-1">
              <CandidateScoreCard candidate={a} summary={summary} results={results} align="start" />
            </div>
          ) : null}
          {b ? (
            <div className="h-full min-w-0 xl:order-3">
              <CandidateScoreCard candidate={b} summary={summary} results={results} align="end" />
            </div>
          ) : null}
        </div>

        <div className="hidden flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-4 py-5 text-center xl:order-2 xl:flex">
          <p className="text-label uppercase tracking-[0.12em] text-accent-text">Apuração presidencial 2026</p>
          <h1 id="live-hero-title" className="text-heading-lg text-fg">
            2º turno
          </h1>
          <StatusPill phase={summary.phase} />
          {meta ? <ModeBadge mode={meta.mode} /> : null}
          <p className="text-body-sm text-fg-soft">{PHASE_HEADLINE[summary.phase]}</p>
          <dl className="w-full space-y-1 text-body-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Última atualização</dt>
              <dd className="tabular font-semibold text-fg">{updated}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Fonte</dt>
              <dd className="font-semibold text-fg">TSE</dd>
            </div>
          </dl>
          <div className="w-full pt-1">
            <Totalization summary={summary} meta={meta} />
          </div>
        </div>
      </div>

      {results ? <ProportionalBar summary={summary} /> : null}

      <div className="mt-4 xl:hidden">
        <h1 className="sr-only">Apuração presidencial 2026 — 2º turno</h1>
        <Totalization summary={summary} meta={meta} />
      </div>
    </section>
  );
}

/** Esqueleto com a geometria final do topo (sem salto de layout enquanto o primeiro snapshot chega). */
export function HeroSkeleton() {
  return (
    <section aria-busy="true" aria-label="Carregando a apuração" className="rounded-3xl" data-testid="live-hero-skeleton">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(240px,300px)_minmax(0,1fr)] xl:gap-5">
        <div className="grid grid-cols-2 gap-3 xl:contents">
          <div className="skeleton h-[188px] rounded-2xl sm:h-[264px] xl:order-1" />
          <div className="skeleton h-[188px] rounded-2xl sm:h-[264px] xl:order-3" />
        </div>
        <div className="skeleton hidden h-[264px] rounded-2xl xl:order-2 xl:block" />
      </div>
      <div className="skeleton mt-4 h-4 rounded-full" />
      <div className="skeleton mt-4 h-14 rounded-xl xl:hidden" />
    </section>
  );
}
