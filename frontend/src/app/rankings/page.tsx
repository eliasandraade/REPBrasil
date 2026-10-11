import type { Metadata } from "next";
import { Suspense } from "react";
import { RankingsExplorer } from "@/components/rankings/RankingsExplorer";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Rankings",
  description:
    "Rankings de dados oficiais do TSE por eleição, cargo, estado e município: mais votados, participação, crescimento, capilaridade, patrimônio declarado, contas de campanha e partidos.",
  path: "/rankings",
});

export default function RankingsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <RankingsExplorer />
    </Suspense>
  );
}
