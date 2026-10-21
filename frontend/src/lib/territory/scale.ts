import { ORDINAL_5, type DataTheme } from "@/lib/dataviz/palette";

/**
 * Escalas do mapa. A cor usa classes por quantil: cada classe reúne uma parte igual dos territórios com dado, o que
 * mantém legível um indicador muito concentrado (população, PIB). A legenda mostra os limites reais de cada classe.
 * Altura do relevo e peso do mapa de calor são proporcionais ao valor (zero = sem altura), nunca à classe.
 */

export interface ScaleClass {
  /** Índice da classe, do menor (0) ao maior valor. */
  index: number;
  color: string;
  from: number;
  to: number;
  /** Territórios com dado nesta classe. */
  count: number;
}

export interface ClassedScale {
  classes: ScaleClass[];
  classOf(value: number): ScaleClass;
}

/** Paleta ordinal validada (um matiz, do mais fraco ao mais forte), espaçada para `k` classes. */
function colorsFor(k: number, theme: DataTheme): string[] {
  const palette = ORDINAL_5[theme];
  if (k <= 1) return [palette[2]];
  return Array.from({ length: k }, (_, i) => palette[Math.round((i * (palette.length - 1)) / (k - 1))]);
}

/** Limites por quantil (k classes), sem classe vazia: valores repetidos fundem classes. */
export function quantileBreaks(values: readonly number[], k = 5): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks = [sorted[0]];
  for (let i = 1; i < k; i++) {
    const at = sorted[Math.min(sorted.length - 1, Math.floor((i * sorted.length) / k))];
    if (at > breaks[breaks.length - 1]) breaks.push(at);
  }
  return breaks;
}

export function classedScale(values: readonly number[], theme: DataTheme, k = 5): ClassedScale | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const starts = quantileBreaks(sorted, k);
  const colors = colorsFor(starts.length, theme);
  // `to` é o maior valor observado dentro da classe: a legenda nunca repete o limite da classe vizinha.
  const classes: ScaleClass[] = starts.map((from, index) => ({ index, color: colors[index], from, to: from, count: 0 }));
  const classOf = (value: number) => {
    let found = classes[0];
    for (const c of classes) if (value >= c.from) found = c;
    return found;
  };
  for (const value of sorted) {
    const c = classOf(value);
    c.count++;
    c.to = Math.max(c.to, value);
  }
  return { classes, classOf };
}

/**
 * Magnitude proporcional (0..1) para relevo e calor: valor ÷ maior valor. Com valores negativos não há zero
 * comum e a magnitude passa a ser a posição entre o menor e o maior (a legenda diz isso).
 */
export function magnitudes(rows: ReadonlyArray<{ code: string; value: number }>): { values: Record<string, number>; proportional: boolean } {
  const finite = rows.filter((r) => Number.isFinite(r.value));
  const values: Record<string, number> = {};
  if (finite.length === 0) return { values, proportional: true };
  const min = Math.min(...finite.map((r) => r.value));
  const max = Math.max(...finite.map((r) => r.value));
  const proportional = min >= 0;
  for (const r of finite) {
    if (proportional) values[r.code] = max > 0 ? r.value / max : 0;
    else values[r.code] = max > min ? (r.value - min) / (max - min) : 0.5;
  }
  return { values, proportional };
}

/**
 * Grandeza somável (contagem ou montante): só nela mapa de calor e pulso fazem sentido. Taxa, índice e valor per
 * capita não se somam no território e ficam fora.
 */
const EXTENSIVE_UNITS = new Set(["pessoas", "habitantes", "eleitores", "votos", "emendas", "R$", "R$ mil"]);

export const isExtensive = (unit: string) => EXTENSIVE_UNITS.has(unit.trim());
