import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ElectionEntitySummary } from "@/components/entities/EntityProfiles";
import { ElectionsExplorer } from "@/components/elections/ElectionsExplorer";
import type { ElectionsResponse } from "@/lib/elections/types";
import { loadElectionProfile } from "@/lib/entities-server";
import { electionMetadata } from "@/lib/seo";
import { serverJson } from "@/lib/server-api";

/** /eleicoes/:ano/:turno[/:uf[/:municipio[/zona/:n[/secao/:n]]]] — o território vive na URL. */
type Props = Readonly<{ params: Promise<{ year: string; round: string; path?: string[] }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year, round, path } = await params;
  return electionMetadata([year, round, ...(path ?? [])]);
}

export default async function ElectionsExplorerPage({ params }: Props) {
  const { year, round, path } = await params;
  // eleição fora do catálogo → 404 de verdade; catálogo indisponível → o explorador mostra o erro
  const catalog = await serverJson<ElectionsResponse>("/api/v1/elections", 600);
  if (catalog && !catalog.elections.some((e) => String(e.year) === year && String(e.round) === round)) notFound();
  const root = !path || path.length === 0;
  const profile = root ? await loadElectionProfile(Number(year), Number(round)) : null;
  return (
    <>
      {profile?.data && <ElectionEntitySummary data={profile.data} />}
      <div id="explorador">
        <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
          <ElectionsExplorer />
        </Suspense>
      </div>
    </>
  );
}
