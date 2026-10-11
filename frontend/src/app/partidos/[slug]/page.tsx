import type { Metadata } from "next";
import { Suspense } from "react";
import { PartyProfile } from "@/components/parties/PartyProfile";
import { pageMetadata } from "@/lib/seo";
import { serverFetch } from "@/lib/server-api";
import type { PartyProfileResponse } from "@/lib/parties";

type Props = Readonly<{ params: Promise<{ slug: string }> }>;

/** Endereço do partido = sigla oficial sem acento (ex.: /partidos/pcdob). */
const clean = (raw: string) => decodeURIComponent(raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = clean((await params).slug);
  const res = slug ? await serverFetch<PartyProfileResponse>(`/api/v1/parties/${slug}?uf=CE`, 3600) : { status: 404, data: null };
  // sem dados (inexistente ou API fora): página não indexável
  if (!res.data)
    return pageMetadata({ title: "Partido", description: "Partido político: resultados oficiais por eleição e cargo.", path: `/partidos/${slug}`, index: false });
  const p = res.data;
  return pageMetadata({
    title: `${p.acronym}${p.name ? ` — ${p.name}` : ""}`,
    description: `Resultados oficiais do ${p.acronym} no Ceará por eleição e cargo: votos do Boletim de Urna, participação, eleitos, municípios e candidaturas.`,
    path: `/partidos/${p.slug}`,
  });
}

export default async function PartidoPage({ params }: Props) {
  const slug = clean((await params).slug);
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <PartyProfile slug={slug} />
    </Suspense>
  );
}
