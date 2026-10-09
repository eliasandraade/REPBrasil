/**
 * Modelo de rota do explorador eleitoral. A URL é a fonte de verdade do
 * território (deep link, refresh, voltar, avançar); filtros analíticos ficam
 * em search params.
 *
 *   /eleicoes
 *   /eleicoes/:ano/:turno                              (Brasil)
 *   /eleicoes/:ano/:turno/:uf                          (ex.: /eleicoes/2026/1/ce)
 *   /eleicoes/:ano/:turno/:uf/:municipio               (slug; código TSE/IBGE é canonizado)
 *   /eleicoes/:ano/:turno/:uf/:municipio/zona/:n
 *   /eleicoes/:ano/:turno/:uf/:municipio/zona/:n/secao/:n
 */

export const ELECTIONS_BASE = "/eleicoes";

export type ExplorerLevel = "country" | "state" | "municipality" | "zone" | "section";

export interface ExplorerRoute {
  year: number;
  round: number;
  state?: string;
  municipality?: string;
  zone?: number;
  section?: number;
}

const positiveInt = (s: string | undefined, max = 4) =>
  s !== undefined && new RegExp(`^\\d{1,${max}}$`).test(s) && Number(s) > 0 ? Number(s) : null;

/** Segmentos após /eleicoes (ou o pathname completo). `null` = rota inválida. */
export function parseElectionsPath(input: string | string[]): ExplorerRoute | null {
  const segments = (Array.isArray(input) ? input : input.split("/"))
    .filter(Boolean)
    .map((s) => decodeURIComponent(s).toLowerCase());
  if (segments[0] === ELECTIONS_BASE.slice(1)) segments.shift();
  if (segments.length < 2 || segments.length > 8) return null;
  const [yearRaw, roundRaw, state, municipality, zoneKw, zone, sectionKw, section] = segments;
  const year = positiveInt(yearRaw);
  const round = positiveInt(roundRaw, 1);
  if (year === null || year < 1900 || round === null) return null;
  const route: ExplorerRoute = { year, round };
  if (!state) return route;
  if (!/^[a-z]{2}$/.test(state)) return null;
  route.state = state;
  if (!municipality) return route;
  if (!/^[a-z0-9-]{1,80}$/.test(municipality)) return null;
  route.municipality = municipality;
  if (!zoneKw) return route;
  const zoneNumber = positiveInt(zone);
  if (zoneKw !== "zona" || zoneNumber === null) return null;
  route.zone = zoneNumber;
  if (!sectionKw) return route;
  const sectionNumber = positiveInt(section);
  if (sectionKw !== "secao" || sectionNumber === null) return null;
  route.section = sectionNumber;
  return route;
}

export function buildElectionsPath(route: ExplorerRoute): string {
  const parts = [ELECTIONS_BASE, String(route.year), String(route.round)];
  if (route.state) {
    parts.push(route.state.toLowerCase());
    if (route.municipality) {
      parts.push(route.municipality);
      if (route.zone != null) {
        parts.push("zona", String(route.zone));
        if (route.section != null) parts.push("secao", String(route.section));
      }
    }
  }
  return parts.join("/");
}

export function levelOf(route: ExplorerRoute): ExplorerLevel {
  if (route.section != null) return "section";
  if (route.zone != null) return "zone";
  if (route.municipality) return "municipality";
  if (route.state) return "state";
  return "country";
}

/** Rota do nível imediatamente acima (Voltar / fechar resultado). */
export function parentRoute(route: ExplorerRoute): ExplorerRoute {
  const base = { year: route.year, round: route.round };
  if (route.section != null) return { ...route, section: undefined };
  if (route.zone != null) return { ...base, state: route.state, municipality: route.municipality };
  if (route.municipality) return { ...base, state: route.state };
  return base;
}

/**
 * Regra genérica de zona: uma única zona ⇒ seleção automática; várias ⇒ o
 * usuário escolhe. Só ao chegar no município (nunca ao voltar da zona).
 */
export function shouldAutoSelectZone(route: ExplorerRoute, zoneCount: number, cameFromZone: boolean): boolean {
  return levelOf(route) === "municipality" && zoneCount === 1 && !cameFromZone;
}
