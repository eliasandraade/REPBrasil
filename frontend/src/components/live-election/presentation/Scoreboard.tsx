"use client";

import Image from "next/image";
import { memo, useMemo, useState } from "react";
import { photoSrc } from "@/lib/live-election/api";
import { initials } from "@/lib/live-election/derive";
import { formatElectionDate, formatPercent, formatPercentagePoints, formatSignedVotes, formatVotes } from "@/lib/live-election/format";
import { isFinal } from "@/lib/live-election/phase";
import { definedLeaderKey, scoreboardOf, type Scoreboard, type ScoreSide } from "@/lib/live-election/presentation";
import type { CandidateSlot, LiveCandidate } from "@/lib/live-election/types";
import { useChangeFlash, useLive } from "../LiveContext";

/** Placar: o valor novo já entra renderizado; o realce (`data-flash`) vem depois, no efeito. */
const FLASH_MS = 700;

/**
 * "51,27%" com o sinal de porcentagem menor (o número é a informação). Sem votação oficial, um molde invisível
 * reserva a altura (o CSS esconde: nenhum número aparece antes do dado).
 */
function Percent({ value }: Readonly<{ value: number | null }>) {
  const text = value === null ? "00,00%" : formatPercent(value);
  return (
    <>
      {text.replace(/%$/, "")}
      <small>%</small>
    </>
  );
}

function Portrait({ candidate }: Readonly<{ candidate: Pick<LiveCandidate, "ballotName" | "photoUrl" | "slot"> }>) {
  const src = photoSrc(candidate.photoUrl);
  const [failed, setFailed] = useState(false);
  return (
    <div className="pm-portrait">
      {src && !failed ? (
        <Image src={src} alt={`Foto oficial de ${candidate.ballotName} (TSE)`} fill sizes="18vw" priority onError={() => setFailed(true)} />
      ) : (
        <span className={`pm-portrait-fallback ${candidate.slot === "a" ? "live-text-a" : "live-text-b"}`} role="img" aria-label={`Foto indisponível de ${candidate.ballotName}`}>
          {initials(candidate.ballotName)}
        </span>
      )}
    </div>
  );
}

function UpMark() {
  return (
    <svg viewBox="0 0 12 12" width="0.9em" height="0.9em" aria-hidden="true">
      <path d="M6 2 11 9H1z" fill="currentColor" />
    </svg>
  );
}

interface PillarProps {
  side: ScoreSide;
  results: boolean;
  tie: boolean;
  final: boolean;
  defined: boolean;
}

/** Polo visual de uma candidatura. A liderança muda a intensidade e a profundidade, nunca o lado da tela. */
const CandidatePillar = memo(function CandidatePillar({ side, results, tie, final, defined }: Readonly<PillarProps>) {
  const { candidate, pct, votes, leading } = side;
  const flashPct = useChangeFlash(pct, FLASH_MS);
  const flashVotes = useChangeFlash(votes, FLASH_MS);
  const lead = results && !tie ? leading : null;
  const official = final && candidate.situation ? candidate.situation.toUpperCase() : null;
  const badge = official
    ? { kind: "official", text: official }
    : !results
      ? null
      : tie
        ? { kind: "tie", text: "EMPATE" }
        : leading
          ? { kind: "lead", text: "NA FRENTE" }
          : { kind: "trail", text: "ATRÁS" };
  const party = `${candidate.number}${candidate.party ? ` · ${candidate.party}` : ""}`;
  const label = results
    ? `${candidate.ballotName}, ${party}: ${formatPercent(pct)} dos votos válidos, ${formatVotes(votes)} votos${badge ? `, ${badge.text.toLowerCase()}` : ""}`
    : `${candidate.ballotName}, ${party}: aguardando a totalização oficial`;
  return (
    <section
      className="pm-candidate"
      data-slot={candidate.slot}
      data-lead={lead === null ? undefined : String(lead)}
      data-defined={defined ? "true" : undefined}
      aria-label={label}
      data-testid={`presentation-candidate-${candidate.slot}`}
    >
      <Portrait candidate={candidate} />
      <span className="pm-badge" data-kind={badge?.kind ?? "none"} style={badge ? undefined : { visibility: "hidden" }} aria-hidden="true">
        {badge?.kind === "lead" ? <UpMark /> : null}
        {badge?.text ?? "—"}
      </span>
      <div>
        <h2 className="pm-name">{candidate.ballotName}</h2>
        <p className="pm-party">{party}</p>
      </div>
      <p className="pm-pct tabular" data-empty={pct === null ? "true" : undefined} aria-hidden={pct === null ? "true" : undefined} data-testid={`presentation-pct-${candidate.slot}`}>
        <span className="pm-value" data-flash={flashPct ? "true" : undefined}>
          <Percent value={pct} />
        </span>
      </p>
      {results ? (
        <p className="pm-votes tabular">
          <span className="pm-value" data-flash={flashVotes ? "true" : undefined}>
            {formatVotes(votes)} votos
          </span>
        </p>
      ) : (
        <p className="pm-wait-note">Aguardando a totalização oficial</p>
      )}
    </section>
  );
});

/** Régua de equilíbrio: A cresce da esquerda, B da direita, marcador fixo em 50%. Na troca de liderança, ele pulsa. */
function BalanceBar({ board, leadScene }: Readonly<{ board: Scoreboard; leadScene: number }>) {
  const [a, b] = board.sides;
  const share = (side: ScoreSide | undefined) => (board.results && side?.pct !== null && side?.pct !== undefined ? side.pct / 100 : 0);
  const lead = (side: ScoreSide | undefined) => (board.results && !board.tie ? String(Boolean(side?.leading)) : undefined);
  const label = board.results
    ? `Proporção dos votos válidos: ${a?.candidate.ballotName} ${formatPercent(a?.pct)}, ${b?.candidate.ballotName} ${formatPercent(b?.pct)}`
    : "Proporção dos votos: aguardando a totalização oficial";
  return (
    <div className="pm-split" role="img" aria-label={label} data-testid="presentation-balance">
      <span className="pm-split-seg" data-slot="a" data-lead={lead(a)} style={{ transform: `scaleX(${share(a)})` }} />
      <span className="pm-split-seg" data-slot="b" data-lead={lead(b)} style={{ transform: `scaleX(${share(b)})` }} />
      <span key={leadScene} className="pm-split-mid" data-pulse={leadScene > 0 ? "true" : undefined} />
    </div>
  );
}

function useBoard(): { board: Scoreboard | null; final: boolean; definedKey: string | null } {
  const summary = useLive((s) => s.summary);
  return useMemo(
    () => (summary ? { board: scoreboardOf(summary), final: isFinal(summary), definedKey: definedLeaderKey(summary) } : { board: null, final: false, definedKey: null }),
    [summary],
  );
}

/** Pilares A e B (áreas a/b da grade) e a régua de equilíbrio (área split). */
export function NationalScoreboard({ leadScene }: Readonly<{ leadScene: number }>) {
  const { board, final, definedKey } = useBoard();
  if (!board) {
    return (
      <>
        <section className="pm-candidate" data-slot="a" aria-busy="true" aria-label="Carregando a candidatura A" />
        <section className="pm-candidate" data-slot="b" aria-busy="true" aria-label="Carregando a candidatura B" />
        <div className="pm-split" aria-hidden="true" />
      </>
    );
  }
  return (
    <>
      {board.sides.map((side) => (
        <CandidatePillar key={side.candidate.key} side={side} results={board.results} tie={board.tie} final={final} defined={definedKey === side.candidate.key} />
      ))}
      <BalanceBar board={board} leadScene={leadScene} />
    </>
  );
}

function Chevron({ side }: Readonly<{ side: CandidateSlot }>) {
  return (
    <svg className="pm-chevron" data-side={side} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Vantagem atual em votos e em pontos percentuais (valores prontos da API), apontando para quem está à frente. */
export function AdvantageIndicator() {
  const { board } = useBoard();
  const flash = useChangeFlash(board?.leadVotes ?? null, FLASH_MS);
  const phase = useLive((s) => s.summary?.phase ?? null);
  const date = useLive((s) => s.summary?.election.date ?? null);
  const final = useLive((s) => (s.summary ? isFinal(s.summary) : false));
  if (!board) return null;
  const leader = board.sides.find((s) => s.leading)?.candidate ?? null;
  const label = final ? "DIFERENÇA FINAL" : "VANTAGEM ATUAL";
  return (
    <aside className="pm-advantage" aria-label={final ? "Diferença final" : "Vantagem atual"} data-testid="presentation-advantage">
      <p className="pm-advantage-label">{label}</p>
      {!board.results ? (
        <>
          <p className="pm-advantage-pp" data-testid="presentation-pre-note">
            {phase === "PRE_ELECTION" ? "Aguardando início da totalização" : "Aguardando a divulgação oficial"}
          </p>
          <p className="pm-advantage-note">
            {date ? `${formatElectionDate(date)} · ` : ""}os dados oficiais entram assim que o TSE os liberar
          </p>
        </>
      ) : board.tie || !leader ? (
        <p className="pm-advantage-votes">EMPATE</p>
      ) : (
        <>
          <p className="pm-advantage-votes tabular">
            <span className="pm-value" data-flash={flash ? "true" : undefined}>
              {formatSignedVotes(board.leadVotes)}
            </span>
            <small>votos</small>
          </p>
          <p className="pm-advantage-pp tabular">{formatPercentagePoints(board.leadPp)}</p>
          <p className="pm-advantage-who">
            <Chevron side={leader.slot} />
            <span className={leader.slot === "a" ? "live-text-a" : "live-text-b"}>{leader.ballotName}</span> à frente
          </p>
        </>
      )}
    </aside>
  );
}
