import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PoliticianPage } from "@/components/politicians/PoliticianPage";
import { lookupPolitician, politicianMetadata } from "@/lib/seo";

/** /politicos/<slug> — endereço público e permanente do perfil (também aceita o id, de links antigos). */
type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return politicianMetadata(slug);
}

export default async function PoliticoPage({ params }: Props) {
  const key = decodeURIComponent((await params).slug);
  const found = await lookupPolitician(key);
  // não existe → 404 de verdade (buscadores e links quebrados); falha da API → a página tenta no navegador
  if (found.status === 404) notFound();
  return <PoliticianPage idOrSlug={key} initial={found.data ?? undefined} />;
}
