import type { LiveCandidate } from "./types";

/**
 * Cor de cada candidatura no 2º turno presidencial de 2026 (regra editorial do proprietário): 13 = vermelho,
 * 22 = azul. A cor segue o NÚMERO, não o slot: o slot vem da ordem `seq` do TSE (`LiveProjector`) e pode
 * mudar entre snapshots ("candidate-update"). Os tokens --live-a/--live-b continuam por slot; aqui só se
 * decide qual das duas cores validadas (--live-red/--live-blue) cada slot veste.
 */
export type CandidateColor = "red" | "blue";

export const CANDIDATE_COLOR_BY_NUMBER: ReadonlyMap<number, CandidateColor> = new Map([
  [13, "red"],
  [22, "blue"],
]);

const other = (color: CandidateColor): CandidateColor => (color === "red" ? "blue" : "red");

/** Cor de cada slot. Sem 13 nem 22 (cenários sintéticos), o padrão é A = vermelho, B = azul. */
export function slotColors(candidates: readonly Pick<LiveCandidate, "slot" | "number">[]): Readonly<{ a: CandidateColor; b: CandidateColor }> {
  const known = (slot: "a" | "b") => {
    const number = candidates.find((c) => c.slot === slot)?.number;
    return number === undefined ? undefined : CANDIDATE_COLOR_BY_NUMBER.get(number);
  };
  const fromB = known("b");
  const a = known("a") ?? (fromB ? other(fromB) : "red");
  return { a, b: other(a) };
}
