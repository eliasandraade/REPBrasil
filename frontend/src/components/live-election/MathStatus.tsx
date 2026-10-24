"use client";

import { useState } from "react";
import { sendProductEvent } from "@/lib/live-election/api";
import { candidateByKey } from "@/lib/live-election/derive";
import { formatVotes } from "@/lib/live-election/format";
import { showsDistanceCard } from "@/lib/live-election/phase";
import { useLive } from "./LiveContext";
import { FlashValue } from "./primitives";

/**
 * "DISTÂNCIA PARA IRREVERSIBILIDADE" — enquanto a eleição não está definida. É só uma desigualdade sobre números
 * oficiais (vantagem × teto conservador de eleitores que ainda podem aparecer); não é previsão nem diz quem
 * vence. Quando o limite é alcançado sem o sinal oficial md=e, a API retém a distância e o card mostra só a
 * vantagem, o eleitorado restante e a nota de que a definição é sinalizada pelo TSE.
 */
export function DistanceCard() {
  const summary = useLive((s) => s.summary);
  const [open, setOpen] = useState(false);
  if (!summary || !showsDistanceCard(summary)) return null;
  const m = summary.math.independent;
  const leader = candidateByKey(summary.candidates, m.leaderKey);
  const runnerUp = candidateByKey(summary.candidates, m.runnerUpKey);
  const withheld = m.distanceToIrreversibility === null;

  return (
    <section aria-labelledby="live-distance-title" data-testid="live-distance-card" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <p className="text-label uppercase text-accent-text">Situação matemática</p>
      <h2 id="live-distance-title" className="mt-1 text-body-lg font-bold uppercase tracking-[0.04em] text-fg">
        Distância para irreversibilidade
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
        <div className="rounded-xl bg-subtle p-3">
          <dt className="text-micro uppercase text-fg-muted">Vantagem atual</dt>
          <dd className="tabular mt-1 text-heading-sm font-bold text-fg">
            <FlashValue value={m.leadVotes}>{formatVotes(m.leadVotes)}</FlashValue>
          </dd>
        </div>
        <div className="rounded-xl bg-subtle p-3">
          <dt className="text-micro uppercase text-fg-muted">Eleitorado potencialmente restante</dt>
          <dd className="tabular mt-1 text-heading-sm font-bold text-fg">
            <FlashValue value={m.remainingElectorateUpperBound}>{formatVotes(m.remainingElectorateUpperBound)}</FlashValue>
          </dd>
        </div>
        {withheld ? (
          <div className="rounded-xl border border-line p-3" data-testid="live-distance-withheld">
            <dt className="text-micro uppercase text-fg-muted">Distância matemática</dt>
            <dd className="mt-1 text-body-sm text-fg-soft">A definição matemática é sinalizada oficialmente pelo TSE.</dd>
          </div>
        ) : (
          <div className="rounded-xl border border-line p-3">
            <dt className="text-micro uppercase text-fg-muted">Distância matemática</dt>
            <dd className="tabular mt-1 text-heading-sm font-bold text-fg" data-testid="live-distance-value">
              <FlashValue value={m.distanceToIrreversibility}>{formatVotes(m.distanceToIrreversibility)}</FlashValue>
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-body-sm text-fg-soft">
        Quanto a vantagem atual precisaria crescer — ou o eleitorado ainda potencialmente apurável precisaria cair — para que,
        mesmo no cenário extremo em que todos esses eleitores votassem no segundo colocado, a liderança não mudasse.
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="live-distance-details"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) sendProductEvent("math_status_open");
        }}
        className="focus-ring mt-2 rounded text-body-sm font-medium text-accent-text hover:underline"
      >
        {open ? "Ocultar o cálculo" : "Como é o cálculo"}
      </button>
      {open ? (
        <div id="live-distance-details" className="mt-2 space-y-2 text-body-sm text-fg-soft">
          <p>
            Teto conservador = eleitores de seções ainda não totalizadas + eleitores de seções não apuradas (dados oficiais
            esnt + esna). Não se estima comparecimento, brancos nem nulos: assume-se o pior caso para quem está à frente.
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt>Votos de quem está à frente{leader ? ` (${leader.ballotName})` : ""}</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(m.leaderVotes)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Votos do segundo colocado{runnerUp ? ` (${runnerUp.ballotName})` : ""}</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(m.runnerUpVotes)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Máximo possível do segundo colocado</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(m.maxPossibleTrailingCandidate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Votos para o segundo colocado alcançar e passar</dt>
              <dd className="tabular font-semibold text-fg">{formatVotes(m.votesNeededForTrailingCandidate)}</dd>
            </div>
          </dl>
          {!m.invariantsOk ? (
            <p className="text-warn">Os totais publicados ainda não fecham entre si; o cálculo aguarda dados consistentes.</p>
          ) : null}
          <p className="text-micro text-fg-muted">
            O sinal canônico de definição matemática é o publicado pelo TSE (md = &quot;e&quot;). Este cálculo é uma validação
            técnica independente e nunca declara resultado.
          </p>
        </div>
      ) : null}
    </section>
  );
}
