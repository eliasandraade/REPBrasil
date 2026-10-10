import type { Metadata } from "next";
import { Suspense } from "react";
import { ElectionsExplorer } from "@/components/elections/ElectionsExplorer";
import { electionMetadata } from "@/lib/seo";

/** /eleicoes/:ano/:turno[/:uf[/:municipio[/zona/:n[/secao/:n]]]] — o território vive na URL. */
type Props = { params: Promise<{ year: string; round: string; path?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year, round, path } = await params;
  return electionMetadata([year, round, ...(path ?? [])]);
}

export default function ElectionsExplorerPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <ElectionsExplorer />
    </Suspense>
  );
}
