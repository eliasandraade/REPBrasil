/**
 * Gramática de profundidade (zoom semântico). Cada rota ocupa uma camada da
 * informação; navegar para uma camada mais específica é aprofundar ("deeper"),
 * voltar a uma mais geral é emergir ("shallower") e mudar de assunto no mesmo
 * nível é "lateral".
 *
 *   0  Início
 *   1  Políticos · Eleições · Manifesto · Suporte
 *   2  Perfil · Eleição (ano/turno)
 *   3  UF
 *   4  Município
 *   5  Zona
 *   6  Seção
 *
 * Ir de um resultado eleitoral para o perfil é sempre "deeper": do voto para a
 * pessoa o dado fica mais específico, embora a rota do perfil seja mais curta.
 */
export type NavDirection = "deeper" | "shallower" | "lateral";

const pathOf = (href: string) => href.split(/[?#]/)[0];

export function routeDepth(href: string): number {
  const parts = pathOf(href).split("/").filter(Boolean);
  if (parts.length === 0) return 0;
  const [root, ...rest] = parts;
  if (root === "politico") return 2;
  if (root !== "eleicoes") return 1;
  // eleicoes/{ano}/{turno}/{uf}/{município}/zona/{n}/secao/{n}
  if (rest.length < 2) return 1;
  const extra = rest.length - 2;
  if (extra === 0) return 2;
  if (extra === 1) return 3;
  if (extra === 2) return 4;
  if (extra <= 4) return 5;
  return 6;
}

export function directionBetween(from: string, to: string): NavDirection {
  const a = pathOf(from);
  const b = pathOf(to);
  if (b.startsWith("/politico/") && a.startsWith("/eleicoes")) return "deeper";
  if (a.startsWith("/politico/") && b.startsWith("/eleicoes")) return "shallower";
  const da = routeDepth(a);
  const db = routeDepth(b);
  if (db > da) return "deeper";
  if (db < da) return "shallower";
  return "lateral";
}
