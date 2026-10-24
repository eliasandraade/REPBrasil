"use client";

import type { ReactNode } from "react";
import { candidateByKey, votesOf } from "@/lib/live-election/derive";
import {
  formatElectionDate,
  formatPercent,
  formatSectionsPct,
  formatTimestamp,
  formatVotes,
} from "@/lib/live-election/format";
import { isDegraded, isFinal, showsMathematicalDefinition } from "@/lib/live-election/phase";
import type { LiveSummary } from "@/lib/live-election/types";
import { useLive, useNow } from "./LiveContext";
import { CandidatePhoto } from "./primitives";

/** Frases oficiais do banner (seção 17 do pedido): exatas, sem linguagem comemorativa. */
export const MATH_DEFINED_TITLE = "ELEIÇÃO MATEMATICAMENTE DEFINIDA";
export const MATH_DEFINED_LINE_1 =
  "Com os votos já totalizados, não há mais votos possíveis em quantidade suficiente para alterar a liderança.";
export const MATH_DEFINED_LINE_2 = "Resultado matematicamente definido segundo os dados oficiais do TSE.";

function MathDefinedBanner({ summary, totalizedAt }: Readonly<{ summary: LiveSummary; totalizedAt: string | null }>) {
  const leaderKey = summary.defined?.leaderKey ?? summary.national.leaderKey;
  const leader = candidateByKey(summary.candidates, leaderKey);
  const v = leader ? votesOf(summary.national, leader.key) : null;
  return (
    <section
      aria-labelledby="live-math-defined-title"
      data-testid="live-math-defined-banner"
      className="rounded-2xl border-2 border-fg/80 bg-surface p-4 sm:p-6"
    >
      <h2 id="live-math-defined-title" className="text-heading-sm font-bold tracking-[0.04em] text-fg sm:text-heading-md">
        {MATH_DEFINED_TITLE}
      </h2>
      <p className="mt-2 max-w-3xl text-body-md text-fg-soft">{MATH_DEFINED_LINE_1}</p>
      <p className="mt-1 text-body-sm font-semibold text-fg">{MATH_DEFINED_LINE_2}</p>
      {leader ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4">
          <CandidatePhoto candidate={leader} size={64} />
          <div className="min-w-0">
            <p className="text-heading-sm font-bold text-fg">{leader.ballotName}</p>
            <p className="text-body-sm text-fg-muted">
              {leader.number}
              {leader.party ? ` · ${leader.party}` : ""}
            </p>
          </div>
          <dl className="grid w-full basis-full grid-cols-2 gap-x-6 gap-y-3 text-body-sm sm:grid-cols-3 2xl:grid-cols-6">
            <div>
              <dt className="text-micro uppercase text-fg-muted">Votos</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(v?.votes)}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-fg-muted">Percentual</dt>
              <dd className="tabular font-semibold text-fg">{formatPercent(v?.pct)}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-fg-muted">Vantagem</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(summary.national.leadVotes)}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-fg-muted">Seções totalizadas</dt>
              <dd className="tabular font-semibold text-fg">{formatSectionsPct(summary.national.sections.totalizedPct)}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-fg-muted">Definição (TSE)</dt>
              <dd className="tabular font-semibold text-fg">{formatTimestamp(summary.defined?.definedAt ?? summary.math.official.definedAt)}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-fg-muted">Última atualização</dt>
              <dd className="tabular font-semibold text-fg">{formatTimestamp(totalizedAt)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      <p className="mt-3 text-micro text-fg-muted">
        A totalização continua até 100% das seções; a totalização final é um ato posterior da Justiça Eleitoral.
      </p>
    </section>
  );
}

function FinalBanner({ summary }: Readonly<{ summary: LiveSummary }>) {
  const elected = summary.candidates.filter((c) => c.elected);
  const noAttribution = summary.official.noElectedAttribution === true;
  return (
    <section aria-labelledby="live-final-title" data-testid="live-final-banner" className="rounded-2xl border border-line-strong bg-surface p-4 sm:p-6">
      <h2 id="live-final-title" className="text-heading-sm font-bold tracking-[0.04em] text-fg sm:text-heading-md">
        RESULTADO FINAL
      </h2>
      <p className="mt-1 text-body-sm text-fg-soft">
        Totalização final registrada pelo TSE{summary.national.totalizedAt ? ` às ${formatTimestamp(summary.national.totalizedAt)}` : ""}.
      </p>
      {noAttribution ? (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 p-3 text-body-sm text-fg">
          <p className="font-semibold">Totalização sem atribuição de eleito.</p>
          {summary.official.noElectedReasons.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-fg-soft">
              {summary.official.noElectedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-3">
          {summary.candidates.map((c) => (
            <li key={c.key} className="rounded-lg border border-line px-3 py-2 text-body-sm">
              <span className="font-semibold text-fg">{c.ballotName}</span>{" "}
              <span className="text-fg-muted">— situação oficial: {c.situation ?? (c.elected ? "Eleito" : "—")}</span>
            </li>
          ))}
        </ul>
      )}
      {!noAttribution && elected.length === 0 ? (
        <p className="mt-2 text-micro text-fg-muted">A situação de cada candidatura é a publicada no arquivo oficial.</p>
      ) : null}
    </section>
  );
}

function Notice({ tone, title, children, testId }: Readonly<{ tone: "neutral" | "warn"; title: string; children?: ReactNode; testId: string }>) {
  const frame = tone === "warn" ? "border-warn/30 bg-warn/10" : "border-line bg-surface";
  return (
    <div role="status" data-testid={testId} className={`rounded-2xl border px-4 py-4 sm:px-6 ${frame}`}>
      <p className="text-body-md font-semibold text-fg">{title}</p>
      {children ? <div className="mt-1 text-body-sm text-fg-soft">{children}</div> : null}
    </div>
  );
}

/** Avisos de estado da apuração logo abaixo do placar. Cada fase tem um texto fixo e factual. */
export function PhaseBanners() {
  const summary = useLive((s) => s.summary);
  const meta = useLive((s) => s.summaryMeta);
  const syncError = useLive((s) => s.syncError);
  const now = useNow(15_000);
  if (!summary) return null;

  const items: ReactNode[] = [];
  if (summary.phase === "PRE_ELECTION") {
    items.push(
      <Notice key="pre" tone="neutral" title="Totalização ainda não iniciada" testId="live-pre-election">
        <p>{formatElectionDate(summary.election.date)}</p>
        <p>Dados oficiais serão exibidos assim que forem liberados pelo TSE.</p>
      </Notice>,
    );
  } else if (summary.phase === "WAITING_FOR_RELEASE" || !summary.official.votesReleased) {
    items.push(
      <Notice key="dv" tone="neutral" title="Dados de votação ainda não liberados para divulgação." testId="live-waiting-release">
        <p>Assim que o TSE liberar a divulgação, o placar aparece aqui automaticamente.</p>
      </Notice>,
    );
  }

  if (showsMathematicalDefinition(summary)) {
    items.push(<MathDefinedBanner key="md" summary={summary} totalizedAt={meta?.totalizedAt ?? summary.national.totalizedAt} />);
  }
  if (isFinal(summary)) items.push(<FinalBanner key="final" summary={summary} />);

  if (isDegraded(summary.phase)) {
    const last = summary.source.lastFileGeneratedAt ?? meta?.sourceGeneratedAt ?? null;
    const since = summary.source.staleSince && now !== null ? Math.max(0, Math.round((now - Date.parse(summary.source.staleSince)) / 60_000)) : null;
    items.push(
      <Notice key="stale" tone="warn" title={summary.phase === "SOURCE_ERROR" ? "Fonte oficial indisponível no momento" : "Dados oficiais sem atualização recente"} testId="live-stale-notice">
        <p>
          {last ? `Última atualização oficial recebida às ${formatTimestamp(last, "time")}. ` : ""}
          Aguardando nova atualização da fonte.
        </p>
        {since !== null && since > 0 ? <p>Dados oficiais sem atualização há {since} {since === 1 ? "minuto" : "minutos"}.</p> : null}
      </Notice>,
    );
  }

  if (summary.official.nonFinalReason) {
    items.push(
      <Notice key="mntf" tone="warn" title="Reprocessamento pendente de totalização final" testId="live-reprocessing">
        <p>
          Motivo informado pelo TSE: <span className="font-medium">{summary.official.nonFinalReason}</span>
        </p>
        <p className="text-micro text-fg-muted">
          Há atualização de registro de candidatura posterior à totalização; o TSE indica que a totalização final será refeita.
        </p>
      </Notice>,
    );
  }

  if (syncError) {
    items.push(
      <Notice key="sync" tone="warn" title="Conexão instável" testId="live-sync-error">
        <p>{syncError}</p>
      </Notice>,
    );
  }

  if (items.length === 0) return null;
  return <div className="flex flex-col gap-3">{items}</div>;
}
