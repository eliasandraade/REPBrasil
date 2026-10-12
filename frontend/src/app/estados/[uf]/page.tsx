import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StateEntityProfile } from "@/components/entities/EntityProfiles";
import { DataState } from "@/components/ui/DataState";
import { stateProfilePath } from "@/lib/entities";
import { loadStateProfile } from "@/lib/entities-server";
import { pageMetadata } from "@/lib/seo";

interface Props {
  params: Promise<{ uf: string }>;
}

const cleanUf = (raw: string) => decodeURIComponent(raw).trim().toUpperCase();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const uf = cleanUf((await params).uf);
  const result = await loadStateProfile(uf);
  if (!result.data)
    return pageMetadata({
      title: "Estado",
      description: "Perfil territorial com histórico eleitoral e dados oficiais.",
      path: stateProfilePath(uf),
      index: false,
    });
  const data = result.data;
  return pageMetadata({
    title: `${data.name} — perfil eleitoral e territorial`,
    description: `${data.name}: histórico eleitoral, municípios, candidatos, partidos e cobertura de indicadores socioeconômicos com fontes oficiais do TSE e IBGE.`,
    path: stateProfilePath(data.uf),
  });
}

export default async function StatePage({ params }: Props) {
  const uf = cleanUf((await params).uf);
  const result = await loadStateProfile(uf);
  if (result.status === 404) notFound();
  if (!result.data)
    return (
      <main className="min-h-screen bg-canvas px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <DataState kind="unavailable" title="Perfil territorial indisponível no momento.">
            A API não respondeu com segurança. Nenhum valor foi presumido enquanto a fonte está indisponível.
          </DataState>
        </div>
      </main>
    );
  return <StateEntityProfile data={result.data} />;
}
