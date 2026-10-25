import { candidateByKey, hasVotes, leadPpOf, leadVotesOf, shareOf, standingOf, votesOf, type TerritoryStanding } from "./derive";
import { formatElectionDate, formatPercent, formatSectionsPct, formatTimestamp } from "./format";
import { isDegraded, isFinal, showsMathematicalDefinition, showsResults } from "./phase";
import type { CandidateSlot, LeadChange, LiveCandidate, LiveMeta, LiveSummary, TerritoryResult } from "./types";

/**
 * Leituras do Modo Apresentação (telão/TV). Mesma regra da página da apuração: nenhum voto, percentual, líder ou
 * vantagem é recalculado aqui — tudo vem pronto da API (`derive.ts`, `phase.ts`). Este módulo só decide o que o
 * palco mostra, em que ordem as UFs entram em foco e o que corre no ticker.
 */

// ------------------------------------------------------------------ estado do palco

export type StageTone = "calm" | "live" | "waiting" | "defined" | "final" | "alert";

export interface StageStatus {
  label: string;
  tone: StageTone;
  /** Selo/ponto "ao vivo": nunca em resultado final nem com a fonte parada. */
  live: boolean;
}

/**
 * Selo do cabeçalho: PRÉ-APURAÇÃO, AO VIVO, AGUARDANDO ATUALIZAÇÃO, ELEIÇÃO DEFINIDA, RESULTADO FINAL. "Definida" só
 * com o sinal oficial md = "e" (mesmo portão do banner da página: `showsMathematicalDefinition`).
 */
export function stageStatus(summary: Pick<LiveSummary, "phase" | "official">): StageStatus {
  if (isFinal(summary)) return { label: "RESULTADO FINAL", tone: "final", live: false };
  const stale = isDegraded(summary.phase);
  if (showsMathematicalDefinition(summary)) return { label: "ELEIÇÃO DEFINIDA", tone: "defined", live: !stale };
  switch (summary.phase) {
    case "PRE_ELECTION":
      return { label: "PRÉ-APURAÇÃO", tone: "calm", live: false };
    case "WAITING_FOR_RELEASE":
      return { label: "AGUARDANDO DIVULGAÇÃO", tone: "calm", live: false };
    case "LIVE_STALE":
      return { label: "AGUARDANDO ATUALIZAÇÃO", tone: "waiting", live: false };
    case "SOURCE_ERROR":
      return { label: "FONTE INDISPONÍVEL", tone: "alert", live: false };
    default:
      return { label: "AO VIVO", tone: "live", live: true };
  }
}

// ------------------------------------------------------------------ placar nacional

export interface ScoreSide {
  candidate: LiveCandidate;
  votes: number | null;
  pct: number | null;
  leading: boolean;
}

export interface Scoreboard {
  /** Sempre na ordem dos slots (A à esquerda, B à direita): a liderança muda a hierarquia, nunca o lado. */
  sides: ScoreSide[];
  /** Há votação oficial para exibir (antes disso, nenhum percentual: zeros não são resultado). */
  results: boolean;
  leaderKey: string | null;
  leaderSlot: CandidateSlot | null;
  tie: boolean;
  leadVotes: number | null;
  leadPp: number | null;
}

export function scoreboardOf(summary: LiveSummary): Scoreboard {
  const results = showsResults(summary) && hasVotes(summary.national);
  const leader = results ? candidateByKey(summary.candidates, summary.national.leaderKey) : null;
  const sides = [...summary.candidates]
    .sort((x, y) => (x.slot === y.slot ? x.position - y.position : x.slot === "a" ? -1 : 1))
    .slice(0, 2)
    .map((candidate) => ({
      candidate,
      votes: results ? (votesOf(summary.national, candidate.key)?.votes ?? null) : null,
      pct: results ? shareOf(summary.national, candidate.key) : null,
      leading: leader?.key === candidate.key,
    }));
  return {
    sides,
    results,
    leaderKey: leader?.key ?? null,
    leaderSlot: leader?.slot ?? null,
    tie: results && !leader,
    leadVotes: results ? leadVotesOf(summary.national) : null,
    leadPp: results ? leadPpOf(summary.national) : null,
  };
}

/** Candidatura com a definição oficial (md = e): a do snapshot `defined`, ou o líder vigente. */
export function definedLeaderKey(summary: LiveSummary): string | null {
  if (!showsMathematicalDefinition(summary)) return null;
  return summary.defined?.leaderKey ?? summary.national.leaderKey;
}

/** Horário do sinal oficial de definição (TSE), para o banner. */
export function definedAt(summary: LiveSummary): string | null {
  return summary.defined?.definedAt ?? summary.math.official.definedAt ?? summary.defined?.detectedAt ?? null;
}

// ------------------------------------------------------------------ UF em foco

export interface SpotlightSide {
  candidate: LiveCandidate;
  votes: number | null;
  pct: number | null;
}

export interface Spotlight {
  uf: string;
  name: string;
  standing: TerritoryStanding;
  leader: LiveCandidate | null;
  sides: SpotlightSide[];
  leadVotes: number | null;
  leadPp: number | null;
  sectionsPct: number | null;
  sectionsTotalized: number | null;
  sectionsRemaining: number | null;
  electorate: number | null;
  totalizedAt: string | null;
  votes: boolean;
}

export function spotlightOf(uf: string, name: string, state: TerritoryResult | undefined, candidates: readonly LiveCandidate[]): Spotlight {
  const votes = hasVotes(state);
  const standing = standingOf(state, candidates);
  return {
    uf,
    name,
    standing,
    leader: votes ? candidateByKey(candidates, state?.leaderKey) : null,
    sides: [...candidates]
      .sort((x, y) => (x.slot === "a" ? -1 : 1) - (y.slot === "a" ? -1 : 1))
      .slice(0, 2)
      .map((candidate) => ({
        candidate,
        votes: votes ? (votesOf(state, candidate.key)?.votes ?? null) : null,
        pct: votes ? shareOf(state, candidate.key) : null,
      })),
    leadVotes: leadVotesOf(state),
    leadPp: leadPpOf(state),
    sectionsPct: state?.available ? state.sections.totalizedPct : null,
    sectionsTotalized: state?.available ? state.sections.totalized : null,
    sectionsRemaining: state?.available ? state.sections.notTotalized : null,
    electorate: state?.electorate.total ?? null,
    totalizedAt: state?.totalizedAt ?? null,
    votes,
  };
}

// ------------------------------------------------------------------ rotação editorial

export type RotationReason = "recent" | "close" | "sequence";

export interface RotationPick {
  uf: string;
  reason: RotationReason;
}

/**
 * Quais UFs entram em foco no próximo ciclo e em que ordem: (1) mudança recente, (2) disputa mais apertada,
 * (3) sequência por eleitorado (cursor circular). Serve SÓ para escolher o que mostrar: nenhuma projeção, nenhuma
 * sugestão de resultado futuro.
 *
 * Pelo menos uma vaga de cada ciclo é sempre da sequência: o cursor anda a cada ciclo e, em no máximo 27 ciclos,
 * todas as UFs aparecem — mesmo com poucas UFs por ciclo e atualizações recentes ou disputas apertadas contínuas.
 * Com 1 UF por ciclo, só a sequência (a justiça da rotação vem antes do "mais apertado").
 */
export function rotationOrder(
  states: readonly TerritoryResult[],
  options: { now: number; count: number; cursor: number; recentWindowMs?: number; exclude?: readonly string[] },
): { picks: RotationPick[]; cursor: number } {
  const ufs = states.filter((s) => s.code.length === 2 && s.code.toUpperCase() !== "ZZ");
  const count = Math.max(1, Math.min(options.count, ufs.length));
  const editorial = count - 1;
  const taken = new Set<string>(options.exclude ?? []);
  const picks: RotationPick[] = [];
  const take = (uf: string, reason: RotationReason, limit: number) => {
    if (taken.has(uf) || picks.length >= limit) return;
    taken.add(uf);
    picks.push({ uf, reason });
  };
  const window = options.recentWindowMs ?? 120_000;
  ufs
    .filter((s) => s.available && s.ingestedAt && options.now - Date.parse(s.ingestedAt) >= 0 && options.now - Date.parse(s.ingestedAt) <= window && hasVotes(s))
    .sort((x, y) => Date.parse(y.ingestedAt ?? "") - Date.parse(x.ingestedAt ?? ""))
    .slice(0, 2)
    .forEach((s) => take(s.code.toUpperCase(), "recent", editorial));
  ufs
    .filter((s) => hasVotes(s) && (s.sections.totalizedPct ?? 0) >= 1 && typeof s.leadPp === "number")
    .sort((x, y) => Math.abs(x.leadPp ?? 0) - Math.abs(y.leadPp ?? 0) || (y.electorate.total ?? 0) - (x.electorate.total ?? 0))
    .slice(0, 2)
    .forEach((s) => take(s.code.toUpperCase(), "close", editorial));
  const sequence = [...ufs].sort((x, y) => (y.electorate.total ?? 0) - (x.electorate.total ?? 0) || x.code.localeCompare(y.code)).map((s) => s.code.toUpperCase());
  let cursor = sequence.length ? options.cursor % sequence.length : 0;
  // Uma UF que já entrou neste ciclo (ou excluída) é pulada, e o cursor anda assim mesmo: a volta segue.
  for (let guard = 0; picks.length < count && guard < sequence.length; guard++) {
    take(sequence[cursor], "sequence", count);
    cursor = (cursor + 1) % sequence.length;
  }
  return { picks, cursor };
}

/** UF anterior/seguinte na ordem alfabética das siglas (navegação manual, previsível). */
export function stepUf(ufs: readonly string[], current: string | null, delta: number): string | null {
  if (ufs.length === 0) return null;
  const ordered = [...ufs].sort((a, b) => a.localeCompare(b));
  const i = current ? ordered.indexOf(current) : -1;
  if (i < 0) return delta >= 0 ? ordered[0] : ordered[ordered.length - 1];
  return ordered[(i + delta + ordered.length) % ordered.length];
}

// ------------------------------------------------------------------ ticker

export interface TickerItem {
  id: string;
  text: string;
  tone?: "default" | "accent" | "warn";
}

/**
 * Faixa inferior. Só fatos já publicados: totalização, UFs (percentual de seções), mudanças de liderança
 * registradas, horário da última atualização oficial e a fonte. Antes da totalização, nenhum percentual de voto.
 */
export function tickerItems(
  summary: LiveSummary,
  meta: LiveMeta | null,
  states: readonly TerritoryResult[],
  leadChanges: readonly LeadChange[],
): TickerItem[] {
  const items: TickerItem[] = [];
  const sections = summary.national.sections.totalizedPct;
  const waiting = summary.phase === "PRE_ELECTION" || summary.phase === "WAITING_FOR_RELEASE";
  if (isFinal(summary)) items.push({ id: "final", text: "RESULTADO FINAL • TOTALIZAÇÃO ENCERRADA PELO TSE", tone: "accent" });
  else if (showsMathematicalDefinition(summary)) {
    const at = definedAt(summary);
    items.push({ id: "md", text: `ELEIÇÃO MATEMATICAMENTE DEFINIDA${at ? ` • SINAL OFICIAL ÀS ${formatTimestamp(at)}` : ""}`, tone: "accent" });
  }
  if (isDegraded(summary.phase)) items.push({ id: "stale", text: "AGUARDANDO NOVA ATUALIZAÇÃO OFICIAL", tone: "warn" });
  if (waiting) {
    items.push({ id: "pre", text: "AGUARDANDO INÍCIO DA TOTALIZAÇÃO" });
    if (summary.election.date) items.push({ id: "date", text: `ELEIÇÃO • ${formatElectionDate(summary.election.date).toUpperCase()}` });
  } else if (typeof sections === "number") {
    items.push({ id: "sections", text: `${formatSectionsPct(sections)} DAS SEÇÕES TOTALIZADAS` });
  }
  for (const change of [...leadChanges].slice(-3).reverse()) {
    const leader = candidateByKey(summary.candidates, change.newLeaderKey);
    if (!leader) continue;
    items.push({ id: `lead-${change.id}`, text: `MUDANÇA DE LIDERANÇA • ${formatTimestamp(change.at ?? change.detectedAt)} • ${leader.ballotName} À FRENTE`, tone: "accent" });
  }
  // Seções por UF só depois que a totalização começa (antes, 27 vezes "0,0%" seria ruído, não informação).
  const ufs = waiting
    ? []
    : states
        .filter((s) => s.code.length === 2 && s.code.toUpperCase() !== "ZZ" && s.available && typeof s.sections.totalizedPct === "number")
        .sort((x, y) => (y.electorate.total ?? 0) - (x.electorate.total ?? 0));
  for (const s of ufs) items.push({ id: `uf-${s.code}`, text: `${s.code.toUpperCase()} • ${formatPercent(s.sections.totalizedPct, 1)}` });
  const updated = meta?.totalizedAt ?? summary.national.totalizedAt ?? summary.source.lastReceivedAt;
  if (updated) items.push({ id: "updated", text: `ÚLTIMA ATUALIZAÇÃO • ${formatTimestamp(updated)}` });
  items.push({ id: "source", text: "FONTE • TSE" });
  return items;
}

// ------------------------------------------------------------------ atalhos e configuração

export type PresentationCommand =
  | "toggle-fullscreen"
  | "exit-fullscreen"
  | "toggle-pause"
  | "prev"
  | "next"
  | "toggle-rotation"
  | "national"
  | "toggle-controls";

interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}

/** Campo de digitação ou controle que já trata a tecla (Espaço num botão ativa o botão: não é atalho). */
function ownsKey(target: EventTarget | null | undefined, key: string): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return true;
  return (key === " " || key === "Enter") && (tag === "button" || tag === "a" || el.getAttribute?.("role") === "button");
}

/** F, Esc, Espaço, ←, →, A, R, M. Nunca sequestra atalho do navegador (Ctrl/⌘/Alt) nem tecla de campo. */
export function commandForKey(e: KeyLike): PresentationCommand | null {
  if (e.altKey || e.ctrlKey || e.metaKey || ownsKey(e.target, e.key)) return null;
  switch (e.key) {
    case "f":
    case "F":
      return "toggle-fullscreen";
    case "Escape":
      return "exit-fullscreen";
    case " ":
    case "Spacebar":
      return "toggle-pause";
    case "ArrowLeft":
      return "prev";
    case "ArrowRight":
      return "next";
    case "a":
    case "A":
      return "toggle-rotation";
    case "r":
    case "R":
      return "national";
    case "m":
    case "M":
      return "toggle-controls";
    default:
      return null;
  }
}

export interface PresentationConfig {
  /** Tempo da visão nacional em cada ciclo (s). */
  nationalSeconds: number;
  /** Tempo de cada UF em foco (s). */
  stateSeconds: number;
  /** UFs por ciclo antes de voltar ao nacional. */
  statesPerCycle: number;
  rotation: boolean;
  /** Abre sem a tela de entrada (sem tela cheia: o navegador só a concede com um gesto). */
  autostart: boolean;
  reducedEffects: boolean;
}

export const DEFAULT_CONFIG: PresentationConfig = {
  nationalSeconds: 25,
  stateSeconds: 10,
  statesPerCycle: 5,
  rotation: true,
  autostart: false,
  reducedEffects: false,
};

const clampInt = (raw: string | null, min: number, max: number, fallback: number) => {
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** `?nacional=25&estado=10&estados=5&rotacao=0&iniciar=1&efeitos=reduzidos` (para quem monta um telão). */
export function parseConfig(params: Pick<URLSearchParams, "get">): PresentationConfig {
  return {
    nationalSeconds: clampInt(params.get("nacional"), 10, 120, DEFAULT_CONFIG.nationalSeconds),
    stateSeconds: clampInt(params.get("estado"), 5, 60, DEFAULT_CONFIG.stateSeconds),
    statesPerCycle: clampInt(params.get("estados"), 1, 27, DEFAULT_CONFIG.statesPerCycle),
    rotation: params.get("rotacao") !== "0",
    autostart: params.get("iniciar") === "1",
    reducedEffects: params.get("efeitos") === "reduzidos",
  };
}
