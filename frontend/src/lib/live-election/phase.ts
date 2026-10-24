import type { LivePhase, LiveSummary } from "./types";

/**
 * Máquina de estados da página → apresentação. A fase vem pronta da API (decidida no backend a partir de
 * and/dv/md/tf e da saúde da fonte); aqui só se decide o que cada fase mostra. Nenhum boolean solto pela página.
 */

export type PhaseTone = "neutral" | "live" | "warn" | "positive" | "danger";

export interface PhaseUi {
  /** Rótulo curto do selo de estado. */
  label: string;
  tone: PhaseTone;
  /** Selo "AO VIVO" (com pulso discreto). Nunca em resultado final. */
  live: boolean;
}

export const PHASE_UI: Readonly<Record<LivePhase, PhaseUi>> = {
  PRE_ELECTION: { label: "Totalização não iniciada", tone: "neutral", live: false },
  WAITING_FOR_RELEASE: { label: "Aguardando divulgação", tone: "neutral", live: false },
  LIVE: { label: "AO VIVO", tone: "live", live: true },
  LIVE_STALE: { label: "Sem atualização recente", tone: "warn", live: false },
  MATHEMATICALLY_DEFINED: { label: "AO VIVO", tone: "live", live: true },
  FINALIZING: { label: "AO VIVO", tone: "live", live: true },
  FINAL: { label: "RESULTADO FINAL", tone: "positive", live: false },
  SOURCE_ERROR: { label: "Fonte indisponível", tone: "danger", live: false },
};

/** Título editorial do estado da apuração (acima do placar). */
export const PHASE_HEADLINE: Readonly<Record<LivePhase, string>> = {
  PRE_ELECTION: "Totalização ainda não iniciada",
  WAITING_FOR_RELEASE: "Aguardando a divulgação oficial",
  LIVE: "Apuração em andamento",
  LIVE_STALE: "Apuração em andamento",
  MATHEMATICALLY_DEFINED: "Eleição matematicamente definida",
  FINALIZING: "Totalização em finalização",
  FINAL: "Resultado final",
  SOURCE_ERROR: "Fonte oficial indisponível no momento",
};

/** Totalização final oficial (tf = s). */
export function isFinal(summary: Pick<LiveSummary, "phase" | "official">): boolean {
  return summary.phase === "FINAL" || summary.official.finalTotalization;
}

/**
 * Banner público de definição matemática: só com o sinal canônico do TSE (md = "e") e antes da totalização
 * final (tf = n). A validação independente do REPBrasil nunca aciona este banner.
 */
export function showsMathematicalDefinition(summary: Pick<LiveSummary, "phase" | "official">): boolean {
  if (isFinal(summary)) return false;
  return summary.phase === "MATHEMATICALLY_DEFINED" || summary.official.mathematicallyDefinedFlag === "e";
}

/**
 * Há votação oficial para exibir? Antes do início ou com dv = n, o placar não mostra números (zeros não são
 * resultado). Em fonte indisponível, o último snapshot recebido continua na tela.
 */
export function showsResults(summary: Pick<LiveSummary, "phase" | "official" | "national">): boolean {
  if (summary.phase === "PRE_ELECTION" || summary.phase === "WAITING_FOR_RELEASE") return false;
  if (!summary.official.votesReleased) return false;
  return summary.national.available;
}

/** O card "Distância para irreversibilidade" só existe enquanto a eleição não está definida nem finalizada. */
export function showsDistanceCard(summary: Pick<LiveSummary, "phase" | "official" | "national" | "math">): boolean {
  return showsResults(summary) && !showsMathematicalDefinition(summary) && !isFinal(summary) && summary.math.independent.available;
}

/** Mensagem de fonte defasada ou indisponível (o último snapshot permanece). */
export function isDegraded(phase: LivePhase): boolean {
  return phase === "LIVE_STALE" || phase === "SOURCE_ERROR";
}
