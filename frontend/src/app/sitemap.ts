import type { MetadataRoute } from "next";
import type { MunicipalitiesResponse } from "@/lib/elections/types";
import type { OverviewResponse } from "@/lib/overview";
import { serverJson } from "@/lib/server-api";
import { INDEXING, SITE_URL } from "@/lib/site";

/** Regerado a cada hora a partir do que está importado. Vazio enquanto a indexação não for liberada. */
export const revalidate = 3600;

const STATIC = ["/", "/eleicoes", "/politicos", "/eleicoes/comparar", "/manifesto", "/suporte"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!INDEXING || !SITE_URL) return [];
  const site = SITE_URL;
  const entries: MetadataRoute.Sitemap = STATIC.map((path) => ({ url: `${site}${path}`, changeFrequency: "weekly" }));

  const overview = await serverJson<OverviewResponse>("/api/v1/overview");
  for (const e of overview?.elections ?? []) {
    const base = `${site}/eleicoes/${e.year}/${e.round}/${e.uf.toLowerCase()}`;
    entries.push({ url: base, changeFrequency: "monthly" });
    const list = await serverJson<MunicipalitiesResponse>(`/api/v1/elections/${e.year}/${e.round}/states/${e.uf}/municipalities`);
    for (const m of list?.municipalities ?? []) {
      if (m.resultsAvailable) entries.push({ url: `${base}/${m.slug}`, changeFrequency: "monthly" });
    }
  }

  const politicians = await serverJson<{ slug: string; updatedAt: string }[]>("/api/v1/politicians/sitemap");
  for (const p of politicians ?? []) {
    entries.push({ url: `${site}/politicos/${encodeURIComponent(p.slug)}`, lastModified: p.updatedAt, changeFrequency: "monthly" });
  }
  return entries;
}
