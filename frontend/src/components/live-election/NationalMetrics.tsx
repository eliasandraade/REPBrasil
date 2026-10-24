"use client";

import type { ReactNode } from "react";
import { completenessOf, leadRatio, safetyMarginOf } from "@/lib/live-election/derive";
import {
  formatInteger,
  formatPercent,
  formatPercentagePoints,
  formatSections,
  formatSectionsPct,
  formatVotes,
  NA,
} from "@/lib/live-election/format";
import { showsResults } from "@/lib/live-election/phase";
import type { LiveSummary } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { MetricRow, ProgressBar, SectionHeading } from "./primitives";

function Group({ title, children, testId }: Readonly<{ title: string; children: ReactNode; testId: string }>) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" data-testid={testId}>
      <h3 className="text-label uppercase text-fg-muted">{title}</h3>
      <dl className="mt-2">{children}</dl>
    </div>
  );
}

const ratio = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function Dispute({ summary }: Readonly<{ summary: LiveSummary }>) {
  const m = summary.math.independent;
  const r = leadRatio(m.leaderVotes, m.runnerUpVotes);
  const margin = safetyMarginOf(m);
  return (
    <Group title="Disputa" testId="live-metrics-dispute">
      <MetricRow label="Votos de quem está à frente" value={formatVotes(m.leaderVotes)} flashKey={m.leaderVotes} />
      <MetricRow label="Votos do segundo colocado" value={formatVotes(m.runnerUpVotes)} flashKey={m.runnerUpVotes} />
      <MetricRow label="Vantagem em votos" value={formatVotes(summary.national.leadVotes)} flashKey={summary.national.leadVotes} />
      <MetricRow label="Vantagem em pontos percentuais" value={formatPercentagePoints(summary.national.leadPp)} />
      <MetricRow label="Razão de vantagem" value={r === null ? NA : `${ratio.format(r)}×`} hint="Votos de quem está à frente divididos pelos do segundo colocado." />
      <MetricRow label="Eleitorado máximo ainda pendente" value={formatVotes(m.remainingElectorateUpperBound)} />
      <MetricRow
        label="Margem matemática de segurança"
        value={margin === null ? NA : formatVotes(margin)}
        hint="Vantagem menos o eleitorado ainda potencialmente apurável (negativa enquanto a liderança ainda pode mudar)."
      />
      <MetricRow label="Distância para irreversibilidade" value={formatVotes(m.distanceToIrreversibility)} />
    </Group>
  );
}

/** KPIs nacionais (seção 24) em quatro grupos, com rótulos explícitos — números oficiais, sem estimativa. */
export function NationalMetrics() {
  const summary = useLive((s) => s.summary);
  if (!summary) return null;
  const n = summary.national;
  const results = showsResults(summary);
  return (
    <section aria-labelledby="live-national-metrics" data-testid="live-national-metrics">
      <SectionHeading
        id="live-national-metrics"
        eyebrow="Brasil"
        title="Números nacionais"
        description="Totais do arquivo nacional do TSE (inclui o exterior). Votos válidos não incluem brancos nem nulos."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Group title="Totalização" testId="live-metrics-sections">
          <MetricRow label="Seções" value={formatSections(n.sections.total)} />
          <MetricRow label="Seções totalizadas" value={formatSections(n.sections.totalized)} extra={formatSectionsPct(n.sections.totalizedPct)} flashKey={n.sections.totalized} />
          <MetricRow label="Seções restantes" value={formatSections(n.sections.notTotalized)} />
          <MetricRow label="Instaladas" value={formatSections(n.sections.installed)} />
          <MetricRow label="Não instaladas" value={formatSections(n.sections.notInstalled)} />
          <MetricRow label="Apuradas" value={formatSections(n.sections.counted)} />
          <MetricRow label="Não apuradas" value={formatSections(n.sections.notCounted)} />
        </Group>
        <Group title="Eleitorado" testId="live-metrics-electorate">
          <MetricRow label="Eleitorado" value={formatInteger(n.electorate.total)} />
          <MetricRow label="Em seções totalizadas" value={formatInteger(n.electorate.inTotalized)} extra={formatPercent(n.electorate.inTotalizedPct)} />
          <MetricRow label="Ainda não totalizado" value={formatInteger(n.electorate.inNotTotalized)} />
          <MetricRow label="Comparecimento" value={formatInteger(n.electorate.turnout)} extra={formatPercent(n.electorate.turnoutPct)} flashKey={n.electorate.turnout} />
          <MetricRow label="Abstenção" value={formatInteger(n.electorate.abstention)} extra={formatPercent(n.electorate.abstentionPct)} />
        </Group>
        {results ? (
          <Group title="Votos" testId="live-metrics-votes">
            <MetricRow label="Votos totais" value={formatVotes(n.votes.total)} flashKey={n.votes.total} />
            <MetricRow label="Válidos" value={formatVotes(n.votes.valid)} extra={formatPercent(n.votes.validPct)} />
            <MetricRow label="Brancos" value={formatVotes(n.votes.blank)} extra={formatPercent(n.votes.blankPct)} />
            <MetricRow label="Nulos" value={formatVotes(n.votes.nullTotal)} extra={formatPercent(n.votes.nullTotalPct)} />
            <MetricRow label="Nulos técnicos" value={formatVotes(n.votes.technicalNull)} />
            <MetricRow label="Anulados" value={formatVotes(n.votes.annulled)} extra={formatPercent(n.votes.annulledPct)} />
            {n.votes.annulledSubJudice ? <MetricRow label="Anulados sub judice" value={formatVotes(n.votes.annulledSubJudice)} /> : null}
            {n.votes.annulledSections ? <MetricRow label="Votos de seções anuladas" value={formatVotes(n.votes.annulledSections)} /> : null}
          </Group>
        ) : (
          <Group title="Votos" testId="live-metrics-votes">
            <p className="py-2 text-body-sm text-fg-muted">Disponível quando a votação oficial começar a ser divulgada.</p>
          </Group>
        )}
        {results ? (
          <Dispute summary={summary} />
        ) : (
          <Group title="Disputa" testId="live-metrics-dispute">
            <p className="py-2 text-body-sm text-fg-muted">Disponível quando a votação oficial começar a ser divulgada.</p>
          </Group>
        )}
      </div>
      {results ? <VoteComposition summary={summary} /> : null}
    </section>
  );
}

/** Composição dos votos totais (válidos, brancos, nulos, anulados) — barra empilhada com rótulos. */
function VoteComposition({ summary }: Readonly<{ summary: LiveSummary }>) {
  const v = summary.national.votes;
  if (!v.total) return null;
  const parts = [
    { key: "valid", label: "Válidos", value: v.valid, cls: "bg-fg-soft" },
    { key: "blank", label: "Brancos", value: v.blank, cls: "bg-line-strong" },
    { key: "null", label: "Nulos", value: v.nullTotal, cls: "bg-fg-muted/60" },
    { key: "annulled", label: "Anulados", value: (v.annulled ?? 0) + (v.annulledSubJudice ?? 0), cls: "bg-warn/70" },
  ].filter((p) => typeof p.value === "number" && p.value > 0) as { key: string; label: string; value: number; cls: string }[];
  const total = v.total;
  return (
    <figure className="mt-3 rounded-2xl border border-line bg-surface p-4" data-testid="live-vote-composition">
      <figcaption className="text-label uppercase text-fg-muted">Composição dos votos totais</figcaption>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-subtle" role="img" aria-label={parts.map((p) => `${p.label} ${formatPercent((p.value / total) * 100)}`).join("; ")}>
        {parts.map((p) => (
          <div key={p.key} className={`live-bar h-full ${p.cls}`} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-micro text-fg-muted">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${p.cls}`} />
            {p.label}: <span className="tabular font-semibold text-fg-soft">{formatVotes(p.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Completude (seção 43): cada indicador separado, sem índice de confiança combinado. */
export function Completeness() {
  const national = useLive((s) => s.summary?.national ?? null);
  if (!national) return null;
  const indicators = completenessOf(national);
  return (
    <section aria-labelledby="live-completeness" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-completeness">
      <h2 id="live-completeness" className="text-label uppercase text-fg-muted">
        Completude do resultado
      </h2>
      <ul className="mt-3 space-y-3">
        {indicators.map((i) => (
          <li key={i.id}>
            <div className="flex items-baseline justify-between gap-2 text-body-sm">
              <span className="text-fg-soft" title={i.description}>
                {i.label}
              </span>
              <span className="tabular font-semibold text-fg">{i.id === "sections" ? formatSectionsPct(i.pct) : formatPercent(i.pct)}</span>
            </div>
            <ProgressBar pct={i.pct} label={i.label} className="mt-1 h-1.5" />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-micro text-fg-muted">Indicadores independentes; nenhum deles é previsão de resultado.</p>
    </section>
  );
}
