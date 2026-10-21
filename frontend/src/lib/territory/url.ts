import { ufOfIbgeCode } from "@/lib/territories";

/**
 * Estado do explorador territorial (/dados) na URL. Todo recorte é reproduzível por link: território, modo,
 * vista e o que cada modo mostra. Valor inválido ou incoerente é descartado (nunca "corrigido" para outro recorte).
 */

export const EXPLORER_MODES = ["socioeconomico", "eleitoral", "emendas"] as const;
export type ExplorerMode = (typeof EXPLORER_MODES)[number];

export const EXPLORER_VIEWS = ["mapa", "relevo", "intensidade", "comparar"] as const;
export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

export const AMENDMENT_METRICS = ["empenhado", "pago", "quantidade"] as const;
export type AmendmentMetric = (typeof AMENDMENT_METRICS)[number];

export type ExplorerLevel = "country" | "state" | "municipality";

/** As 27 UFs, em ordem alfabética da sigla. */
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export interface ExplorerState {
  /** Sigla da UF. */
  uf: string | null;
  /** Código IBGE (7 dígitos) do município, sempre da UF escolhida. */
  municipality: string | null;
  mode: ExplorerMode;
  view: ExplorerView;
  /** Indicador principal (socioeconômico). */
  x: string | null;
  /** Segundo indicador: comparação X × Y e antes/depois entre indicadores. */
  y: string | null;
  /** Período do indicador. */
  period: number | null;
  /** Ano do pleito (eleitoral) ou das emendas. */
  year: number | null;
  round: 1 | 2 | null;
  /** Código TSE do cargo. */
  office: number | null;
  metric: AmendmentMetric;
  /** Lado "antes" do antes/depois: pleito "ano:turno" (eleitoral) ou ano (emendas). */
  before: string | null;
}

const INDICATOR = /^[a-z][a-z0-9_.]{0,79}$/;
const BEFORE = /^\d{4}(:[12])?$/;

function yearOf(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1900 && value <= 2200 ? value : null;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  return values.includes(raw as T) ? (raw as T) : fallback;
}

type Params = { get(name: string): string | null };

export function parseExplorerState(params: Params): ExplorerState {
  const rawMunicipality = params.get("municipio");
  const code = rawMunicipality && /^\d{7}$/.test(rawMunicipality) ? rawMunicipality : null;
  const ufFromCode = code ? ufOfIbgeCode(code) : null;
  const rawUf = (params.get("uf") ?? "").trim().toUpperCase();
  // A UF explícita prevalece; sem ela, a do código IBGE do município (os 2 primeiros dígitos são a UF).
  const uf = (UFS as readonly string[]).includes(rawUf) ? rawUf : ufFromCode;
  const x = params.get("x");
  const y = params.get("y");
  const round = Number(params.get("turno"));
  const office = Number(params.get("cargo"));
  const before = params.get("antes");
  return {
    uf,
    municipality: code && uf && ufFromCode === uf ? code : null,
    // links antigos de /dados (alertas de indicador) trazem só x e período: modo socioeconômico
    mode: oneOf(EXPLORER_MODES, params.get("modo"), "socioeconomico"),
    view: oneOf(EXPLORER_VIEWS, params.get("vista"), "mapa"),
    x: x && INDICATOR.test(x) ? x : null,
    y: y && INDICATOR.test(y) && y !== x ? y : null,
    period: yearOf(params.get("periodo")),
    year: yearOf(params.get("ano")),
    round: round === 1 || round === 2 ? round : null,
    office: Number.isInteger(office) && office > 0 && office < 100 ? office : null,
    metric: oneOf(AMENDMENT_METRICS, params.get("metrica"), "empenhado"),
    before: before && BEFORE.test(before) ? before : null,
  };
}

/** Query string canônica do estado (valores padrão omitidos), na ordem do mais geral ao mais específico. */
export function explorerQuery(state: ExplorerState): string {
  const query = new URLSearchParams();
  const put = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  };
  put("uf", state.uf);
  put("municipio", state.municipality);
  if (state.mode !== "socioeconomico") put("modo", state.mode);
  if (state.view !== "mapa") put("vista", state.view);
  put("x", state.x);
  put("y", state.y);
  put("periodo", state.period);
  put("ano", state.year);
  put("turno", state.round);
  put("cargo", state.office);
  if (state.metric !== "empenhado") put("metrica", state.metric);
  put("antes", state.before);
  return query.toString();
}

export function explorerHref(state: ExplorerState): string {
  const query = explorerQuery(state);
  return query ? `/dados?${query}` : "/dados";
}

/** Explorador aberto num indicador e território (cards dos perfis de UF e de município). */
export function indicatorHref(code: string, period: number, uf: string, municipality: string | null = null): string {
  return explorerHref({ ...parseExplorerState(new URLSearchParams()), uf: uf.toUpperCase(), municipality, x: code, period });
}

export function levelOf(state: Pick<ExplorerState, "uf" | "municipality">): ExplorerLevel {
  if (state.municipality) return "municipality";
  return state.uf ? "state" : "country";
}
