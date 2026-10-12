import type { MetadataRoute } from "next";
import type { MunicipalitiesResponse } from "@/lib/elections/types";
import { electionProfilePath, municipalityProfilePath, stateProfilePath } from "@/lib/entities";
import type { OverviewResponse } from "@/lib/overview";
import type { PartiesResponse } from "@/lib/parties";
import { serverJson } from "@/lib/server-api";
import { INDEXING, SITE_URL } from "@/lib/site";

/** Regerado a cada hora a partir do que está importado. Vazio enquanto a indexação não for liberada. */
export const revalidate = 3600;

const STATIC = ["/", "/eleicoes", "/pesquisas", "/politicos", "/partidos", "/rankings", "/comparar", "/dados", "/eleicoes/comparar", "/glossario", "/manifesto", "/suporte"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!INDEXING || !SITE_URL) return [];
  const site = SITE_URL;
  const entries: MetadataRoute.Sitemap = STATIC.map((path) => ({ url: `${site}${path}`, changeFrequency: "weekly" }));

  const overview = await serverJson<OverviewResponse>("/api/v1/overview");
  const elections = overview?.elections ?? [];
  const lists = await Promise.all(
    elections.map((e) => serverJson<MunicipalitiesResponse>(`/api/v1/elections/${e.year}/${e.round}/states/${e.uf}/municipalities`)),
  );
  const electionProfiles = new Set<string>();
  const stateProfiles = new Set<string>();
  const municipalityProfiles = new Set<string>();
  elections.forEach((e, i) => {
    electionProfiles.add(electionProfilePath(e.year, e.round));
    stateProfiles.add(stateProfilePath(e.uf));
    const base = `${site}/eleicoes/${e.year}/${e.round}/${e.uf.toLowerCase()}`;
    entries.push({ url: base, changeFrequency: "monthly" });
    for (const m of lists[i]?.municipalities ?? []) {
      if (m.resultsAvailable) entries.push({ url: `${base}/${m.slug}`, changeFrequency: "monthly" });
      if (m.territoryKnown) municipalityProfiles.add(municipalityProfilePath(e.uf, m.slug));
    }
  });
  for (const path of electionProfiles) entries.push({ url: `${site}${path}`, changeFrequency: "monthly" });
  for (const path of stateProfiles) entries.push({ url: `${site}${path}`, changeFrequency: "monthly" });
  for (const path of municipalityProfiles) entries.push({ url: `${site}${path}`, changeFrequency: "monthly" });

  const parties = await serverJson<PartiesResponse>("/api/v1/parties?uf=CE");
  for (const p of parties?.parties ?? []) entries.push({ url: `${site}/partidos/${encodeURIComponent(p.slug)}`, changeFrequency: "monthly" });

  const politicians = await serverJson<{ slug: string; updatedAt: string }[]>("/api/v1/politicians/sitemap");
  for (const p of politicians ?? []) {
    entries.push({ url: `${site}/politicos/${encodeURIComponent(p.slug)}`, lastModified: p.updatedAt, changeFrequency: "monthly" });
  }
  return entries;
}
