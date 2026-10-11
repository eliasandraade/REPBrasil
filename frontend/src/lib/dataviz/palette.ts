/**
 * Paletas de DADOS do REPBrasil — separadas das cores de marca (docs/BRAND.md §"Marca ≠ semântica").
 *
 * Nenhuma cor aqui representa partido, ideologia, vencedor ou perdedor; a marca (navy/teal/green)
 * não é usada para dado. Mapas eleitorais são neutros; cor de partido só em contexto explicitamente
 * partidário, com legenda (módulo próprio, nunca este).
 *
 * Validação (skill dataviz, scripts/validate_palette.js) contra as superfícies reais do produto:
 * - categórica clara sobre #FFFFFF: todas as checagens passam; slots 3, 4 e 5 abaixo de 3:1 ⇒ alívio
 *   obrigatório (rótulo direto, tooltip com nome e tabela) — o explorador sempre tem lista e tooltip;
 * - categórica escura sobre #0D2744: todas as checagens passam (≥ 3:1).
 * - Formas com TODOS os pares em jogo (coroplético, pontos): só os 3 primeiros slots são seguros;
 *   a partir do 4º, agrupar em "Outros" (CHOROPLETH_SLOTS).
 * Ordem fixa, nunca reciclada: a cor segue a entidade (posição na legenda), nunca o partido.
 */

export type DataTheme = "light" | "dark";

export const CATEGORICAL: Record<DataTheme, readonly string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/** Em coropléticos só os 3 primeiros slots passam o teste de todos os pares. */
export const CHOROPLETH_SLOTS = 3;

/** Sequencial (magnitude): um matiz (azul), claro → escuro no tema claro; recua para a superfície no escuro. */
export const SEQUENTIAL: Record<DataTheme, { low: string; high: string }> = {
  light: { low: "#cde2fb", high: "#104281" },
  dark: { low: "#163a63", high: "#9ec5f4" },
};

/** Divergente (crescimento × queda): dois polos (azul × laranja) e meio neutro cinza — nunca matiz no meio. */
export const DIVERGING: Record<DataTheme, { positive: string; negative: string; neutral: string }> = {
  light: { positive: "#1c5cab", negative: "#c4511f", neutral: "#d9dee4" },
  dark: { positive: "#3987e5", negative: "#d95926", neutral: "#3a4f66" },
};

/** A × B: os dois primeiros slots categóricos (funcionais e estáveis, sem inferir ideologia). */
export const AB: Record<DataTheme, { a: string; b: string; tie: string }> = {
  light: { a: CATEGORICAL.light[0], b: CATEGORICAL.light[1], tie: "#8a96a3" },
  dark: { a: CATEGORICAL.dark[0], b: CATEGORICAL.dark[1], tie: "#8597aa" },
};

/**
 * Ordinal de 5 passos (um matiz), do mais fraco ao mais forte — classes da Base Eleitoral. Validado com
 * `--ordinal` contra a terra do mapa: claro sobre #E4EAF0 (o passo mais claro ≥ 2:1), escuro sobre #15304D
 * (no escuro, mais forte = mais claro).
 */
export const ORDINAL_5: Record<DataTheme, readonly string[]> = {
  light: ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  dark: ["#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6", "#e6f0fc"],
};

/** "Outros" (dobra de categorias além do limite seguro). */
export const OTHER: Record<DataTheme, string> = { light: "#9aa6b2", dark: "#6b7f94" };

/**
 * Cromo do mapa: terra SEM dado (distinta de zero — zero é o primeiro passo da rampa), contornos,
 * seleção (interação = teal da marca, nunca dado) e pontos.
 */
export const MAP_CHROME: Record<
  DataTheme,
  { background: string; land: string; landSelected: string; border: string; borderOpacity: number; selection: string; point: string; pointStroke: string }
> = {
  light: {
    background: "#F5F8FB",
    land: "#E4EAF0",
    landSelected: "#D3E7E4",
    border: "#5F7184",
    borderOpacity: 0.35,
    selection: "#00BAA6",
    point: "#FFFFFF",
    pointStroke: "#0B2D5B",
  },
  dark: {
    background: "#071A2E",
    land: "#15304D",
    landSelected: "#164A4C",
    border: "#A9BBCB",
    borderOpacity: 0.22,
    selection: "#23D6C2",
    point: "#0D2744",
    pointStroke: "#23D6C2",
  },
};

function channels(c: string): [number, number, number] {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Interpolação linear em sRGB entre dois hex (t em [0, 1]). */
export function mix(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r1 + (r2 - r1) * k)}${to(g1 + (g2 - g1) * k)}${to(b1 + (b2 - b1) * k)}`;
}
