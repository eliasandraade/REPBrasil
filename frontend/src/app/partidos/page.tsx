import type { Metadata } from "next";
import { Suspense } from "react";
import { PartiesExplorer } from "@/components/parties/PartiesExplorer";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Partidos",
  description:
    "Força dos partidos em cada eleição e cargo, com votos do Boletim de Urna (nominais e de legenda), candidaturas oficiais, eleitos e variação entre eleições.",
  path: "/partidos",
});

export default function PartidosPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <PartiesExplorer />
    </Suspense>
  );
}
