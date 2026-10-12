import type { Metadata } from "next";
import { electionMetadata } from "@/lib/seo";

/** /eleicoes/:ano/:turno[/:uf[/:municipio[/zona/:n[/secao/:n]]]] — o território vive na URL. */
type Props = Readonly<{ params: Promise<{ year: string; round: string; path?: string[] }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year, round, path } = await params;
  return electionMetadata([year, round, ...(path ?? [])]);
}

export default function ElectionsExplorerPage() { return null; }
