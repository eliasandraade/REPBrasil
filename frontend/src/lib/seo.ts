/**
 * Metadados de busca e compartilhamento (título, descrição, canonical, Open Graph, robots).
 * O canonical e o Open Graph só levam endereço absoluto quando o site tem endereço público (SITE_URL);
 * `index` só vale se a indexação estiver ligada (INDEXING).
 */
import type { Metadata } from "next";
import { displayName } from "./elections/format";
import { parseElectionsPath, type ExplorerRoute } from "./elections/route";
import { isUuid, politicianPath } from "./paths";
import type { MunicipalitiesResponse } from "./elections/types";
import { serverFetch, serverJson } from "./server-api";
import { INDEXING, SITE_NAME, SITE_URL, ufName } from "./site";
import type { PoliticianDetail } from "./types";

export interface PageSeo {
  title: string;
  description: string;
  /** Caminho canônico ("/eleicoes/2026/1/ce"). */
  path: string;
  /** Página que vale a pena indexar (zona/seção e consultas com parâmetros não valem). */
  index?: boolean;
  /** Título exato, sem o sufixo " · REPBrasil". */
  absoluteTitle?: boolean;
}

export function pageMetadata({ title, description, path, index = true, absoluteTitle = false }: PageSeo): Metadata {
  const indexable = INDEXING && index;
  return {
    title: { absolute: absoluteTitle ? title : `${title} · ${SITE_NAME}` },
    description,
    alternates: SITE_URL ? { canonical: path } : undefined,
    robots: indexable ? { index: true, follow: true } : { index: false, follow: indexable || INDEXING },
    openGraph: {
      title: absoluteTitle ? title : `${title} · ${SITE_NAME}`,
      description,
      siteName: SITE_NAME,
      locale: "pt_BR",
      type: "website",
      ...(SITE_URL ? { url: path } : {}),
    },
  };
}

/** Cargo do cadastro legado ("DEPUTADO FEDERAL") em caixa de título. */
const officeLabel = (office: string | null | undefined) => (office ? displayName(office) : null);

/** Perfil pelo slug ou pelo id (a mesma leitura serve aos metadados e à página: o Next reaproveita o fetch). */
export function lookupPolitician(key: string) {
  return serverFetch<PoliticianDetail>(
    isUuid(key) ? `/api/v1/politicians/${encodeURIComponent(key)}` : `/api/v1/politicians/slug/${encodeURIComponent(key)}`,
  );
}

export async function politicianMetadata(idOrSlug: string): Promise<Metadata> {
  const key = decodeURIComponent(idOrSlug);
  const politician = (await lookupPolitician(key)).data;
  if (!politician) {
    return pageMetadata({
      title: "Perfil de político",
      description: "Histórico eleitoral, votos por território, patrimônio declarado e contas de campanha, com fonte oficial do TSE.",
      path: `/politicos/${encodeURIComponent(key)}`,
      index: false,
    });
  }
  const ballot = displayName(politician.ballotName || politician.name);
  const civil = displayName(politician.name);
  // candidatura oficial mais recente; o cadastro antigo só quando não há camada eleitoral
  const latest = politician.latestCandidacy;
  const role = latest
    ? [latest.officeName, latest.unitName ? displayName(latest.unitName) : null, latest.party, String(latest.year)].filter(Boolean).join(" · ")
    : [officeLabel(politician.office), politician.partyAcronym, ufName(politician.state)].filter(Boolean).join(" · ");
  return pageMetadata({
    title: role ? `${ballot} — ${role}` : ballot,
    description:
      `${civil === ballot ? ballot : ballot + " (" + civil + ")"}: histórico eleitoral, votos por município, zona e seção, ` +
      "patrimônio declarado e contas de campanha, com a fonte oficial do TSE em cada número.",
    path: politicianPath(politician),
    // perfil acessado pelo id é o mesmo documento do slug: indexa só o canônico
    index: !!politician.slug,
  });
}

const roundLabel = (round: number) => `${round}º turno`;

/** Explorador: título pelo território da URL; zona e seção não são indexadas (milhares de páginas finas). */
export async function electionMetadata(segments: string[]): Promise<Metadata> {
  const route = parseElectionsPath(["eleicoes", ...segments]);
  if (!route) return pageMetadata({ title: "Eleição não encontrada", description: "Endereço de eleição inválido.", path: "/eleicoes", index: false });
  const election = `Eleições ${route.year} · ${roundLabel(route.round)}`;
  const place = await placeName(route);
  const where = place ?? (route.state ? ufName(route.state) : "Brasil");
  const deep = route.zone != null;
  const territory = [
    route.zone != null ? `Zona ${String(route.zone).padStart(3, "0")}` : null,
    route.section != null ? `Seção ${String(route.section).padStart(4, "0")}` : null,
  ].filter(Boolean).join(" · ");
  return pageMetadata({
    title: [territory, where, election].filter(Boolean).join(" — "),
    description:
      `Resultado oficial do TSE em ${where} (${election.toLowerCase()}): votos por candidato, brancos, nulos e abstenção, ` +
      "do estado até a seção eleitoral, com o Boletim de Urna de origem.",
    path: electionsCanonical(route),
    index: !deep,
  });
}

function electionsCanonical(route: ExplorerRoute): string {
  const parts = ["/eleicoes", String(route.year), String(route.round)];
  if (route.state) parts.push(route.state.toLowerCase());
  if (route.state && route.municipality) parts.push(route.municipality);
  if (route.zone != null) parts.push("zona", String(route.zone));
  if (route.section != null) parts.push("secao", String(route.section));
  return parts.join("/");
}

/** Nome do município pelo slug (lista da UF, em cache); "Fortaleza (CE)". */
async function placeName(route: ExplorerRoute): Promise<string | null> {
  if (!route.state || !route.municipality) return null;
  const list = await serverJson<MunicipalitiesResponse>(
    `/api/v1/elections/${route.year}/${route.round}/states/${encodeURIComponent(route.state)}/municipalities`,
  );
  const found = list?.municipalities?.find((m) => m.slug === route.municipality);
  return found ? `${displayName(found.name)} (${route.state.toUpperCase()})` : null;
}
