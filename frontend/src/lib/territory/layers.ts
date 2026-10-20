import { MAP_CHROME, ORDINAL_5, type DataTheme } from "@/lib/dataviz/palette";
import type { StateCoverage } from "@/lib/data-intelligence";
import type { MapLayerView } from "@/lib/elections/map-layers";
import { availabilityText, hasData } from "./coverage";
import { formatShort, formatValue } from "./format";
import { classedScale, magnitudes, type ClassedScale } from "./scale";
import type { ExplorerMode } from "./url";

/**
 * Camada do mapa territorial: cor, texto e magnitude por território, já resolvidos. O mapa só desenha; quem
 * decide cor e legenda é este módulo, a partir de valores oficiais. Território sem entrada fica na cor da terra
 * (sem dado), nunca em "zero".
 */

export interface LegendItem {
  color: string;
  label: string;
}

export type CanvasLegend =
  | { kind: "classes"; title: string; items: LegendItem[]; note: string }
  | { kind: "categories"; title: string; items: LegendItem[]; note?: string }
  | { kind: "gradient"; title: string; from: string; to: string; min: string; max: string; note?: string };

export interface CanvasLayer {
  /** Muda quando o conteúdo muda: dispara a transição entre camadas. */
  key: string;
  /** UFs (código IBGE de 2 dígitos) ou municípios (7 dígitos). */
  level: "country" | "state";
  colors: Record<string, string>;
  texts: Record<string, string>;
  /** 0..1 para relevo, calor e pulso. Vazio em camada categórica. */
  magnitudes: Record<string, number>;
  /** Grandeza somável: libera mapa de calor e pulso. */
  extensive: boolean;
  /** Magnitude proporcional ao valor (zero = sem altura) ou posição entre mínimo e máximo. */
  proportional: boolean;
  legend: CanvasLegend | null;
  /** O que a camada mostra, com período: vai no rótulo do mapa e no painel. */
  caption: string;
  /** Maior valor, formatado: referência da altura no relevo. */
  maxText?: string;
}

/** O que a vista acrescenta à leitura da legenda (relevo e calor mudam o que a forma significa). */
export function viewNote(view: "mapa" | "relevo" | "intensidade" | "comparar", layer: CanvasLayer | null): string | null {
  if (!layer) return null;
  if (view === "relevo")
    return layer.proportional
      ? `Altura proporcional ao valor: zero não tem altura${layer.maxText ? `; o mais alto é ${layer.maxText}` : ""}.`
      : "Altura: posição de cada território entre o menor e o maior valor (há valores negativos).";
  if (view === "intensidade")
    return "Mapa de calor: cada município pesa pelo seu valor, a partir de um ponto interno da malha oficial. Mostra concentração, não fronteira.";
  return null;
}

export interface ValueRow {
  code: string;
  value: number;
}

export function valueLayer(input: {
  key: string;
  level: "country" | "state";
  rows: readonly ValueRow[];
  unit: string;
  title: string;
  caption: string;
  theme: DataTheme;
  extensive: boolean;
  /** Escala comum (antes/depois do mesmo indicador): as duas metades ficam comparáveis. */
  scale?: ClassedScale | null;
}): CanvasLayer {
  const rows = input.rows.filter((r) => Number.isFinite(r.value));
  const scale = input.scale ?? classedScale(rows.map((r) => r.value), input.theme);
  const colors: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const row of rows) {
    texts[row.code] = formatValue(row.value, input.unit);
    if (scale) colors[row.code] = scale.classOf(row.value).color;
  }
  const { values, proportional } = magnitudes(rows);
  const max = rows.length ? Math.max(...rows.map((r) => r.value)) : null;
  return {
    key: input.key,
    maxText: max === null ? undefined : formatValue(max, input.unit),
    level: input.level,
    colors,
    texts,
    magnitudes: values,
    extensive: input.extensive,
    proportional,
    caption: input.caption,
    legend: scale
      ? {
          kind: "classes",
          title: input.title,
          items: scale.classes.map((c) => ({
            color: c.color,
            label: c.from === c.to ? formatShort(c.from, input.unit) : `${formatShort(c.from, input.unit)} a ${formatShort(c.to, input.unit)}`,
          })),
          note: "Cada cor reúne uma parte igual dos territórios com dado. Sem cor: sem dado carregado.",
        }
      : null,
  };
}

/** Mapa do Brasil no modo escolhido: quais UFs têm dado carregado. Não é avaliação de UF, é cobertura. */
export function coverageLayer(states: readonly StateCoverage[], mode: ExplorerMode, theme: DataTheme, modeLabel: string): CanvasLayer {
  const color = ORDINAL_5[theme][2];
  const colors: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const state of states) {
    if (state.ibgeCode == null) continue;
    const code = String(state.ibgeCode);
    texts[code] = availabilityText(state, mode);
    if (hasData(state, mode)) colors[code] = color;
  }
  return {
    key: `coverage:${mode}:${theme}:${Object.keys(colors).sort().join(",")}`,
    level: "country",
    colors,
    texts,
    magnitudes: {},
    extensive: false,
    proportional: true,
    caption: `${modeLabel}: o que está carregado em cada UF`,
    legend: {
      kind: "categories",
      title: "Cobertura",
      items: [
        { color, label: "Com dados carregados" },
        { color: MAP_CHROME[theme].land, label: "Sem dados carregados" },
      ],
      note: "Toda UF tem malha municipal oficial (IBGE) para navegar; valores só onde há dado.",
    },
  };
}

/** Camada eleitoral já resolvida pelo explorador eleitoral (cores neutras, sem cor partidária). */
export function electoralLayer(view: MapLayerView, key: string, caption: string): CanvasLayer {
  const colors: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const [code, value] of Object.entries(view.municipalities)) {
    texts[code] = value.text;
    if (value.color) colors[code] = value.color;
  }
  const legend: CanvasLegend | null = view.gradient
    ? { kind: "gradient", title: caption, from: view.gradient.from, to: view.gradient.to, min: view.gradient.min, max: view.gradient.max, note: view.note }
    : view.legend.length
      ? { kind: "categories", title: caption, items: view.legend.map((l) => ({ color: l.color, label: l.label })), note: view.note }
      : null;
  return { key, level: "state", colors, texts, magnitudes: {}, extensive: false, proportional: true, legend, caption };
}

/** Assinatura estável do que a camada escreve no mapa. */
export function canvasSignature(layer: CanvasLayer | null | undefined): string {
  if (!layer) return "";
  const colors = Object.entries(layer.colors).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`);
  return `${layer.key}|${layer.level}|${colors.join(",")}`;
}
