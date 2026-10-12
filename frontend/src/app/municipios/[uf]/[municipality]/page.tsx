import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MunicipalityEntityProfile } from "@/components/entities/EntityProfiles";
import { DataState } from "@/components/ui/DataState";
import { municipalityProfilePath } from "@/lib/entities";
import { loadMunicipalityProfile } from "@/lib/entities-server";
import { pageMetadata } from "@/lib/seo";

interface Props {
  params: Promise<{ uf: string; municipality: string }>;
}

const cleanUf = (raw: string) => decodeURIComponent(raw).trim().toUpperCase();
const cleanMunicipality = (raw: string) => decodeURIComponent(raw).trim().slice(0, 120);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const values = await params;
  const uf = cleanUf(values.uf);
  const key = cleanMunicipality(values.municipality);
  const result = await loadMunicipalityProfile(uf, key);
  if (!result.data)
    return pageMetadata({
      title: "Município",
      description: "Perfil municipal com histórico eleitoral e indicadores oficiais.",
      path: municipalityProfilePath(uf, key),
      index: false,
    });
  const data = result.data;
  return pageMetadata({
    title: `${data.name} (${data.uf}) — perfil socioeleitoral`,
    description: `${data.name}: histórico eleitoral, candidatos e partidos mais votados, zonas e seções, além de indicadores socioeconômicos oficiais com período e fonte explícitos.`,
    path: municipalityProfilePath(data.uf, data.slug),
  });
}

export default async function MunicipalityPage({ params }: Props) {
  const values = await params;
  const uf = cleanUf(values.uf);
  const key = cleanMunicipality(values.municipality);
  const result = await loadMunicipalityProfile(uf, key);
  if (result.status === 404) notFound();
  if (!result.data)
    return (
      <main className="min-h-screen bg-canvas px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <DataState kind="unavailable" title="Perfil municipal indisponível no momento.">
            Uma ou mais fontes necessárias não responderam. O REPBrasil não converte essa falha em ausência ou zero.
          </DataState>
        </div>
      </main>
    );
  const canonical = municipalityProfilePath(result.data.uf, result.data.slug);
  const requested = municipalityProfilePath(uf, key);
  if (canonical !== requested) redirect(canonical);
  return <MunicipalityEntityProfile data={result.data} />;
}
