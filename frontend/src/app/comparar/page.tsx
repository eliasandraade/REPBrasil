import type { Metadata } from "next";
import { Suspense } from "react";
import { UniversalCompare } from "@/components/compare/UniversalCompare";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Comparar",
  description: "Compare candidaturas, partidos, municípios e eleições com guardas de comparabilidade, insights determinísticos e exports auditáveis.",
  path: "/comparar",
});

export default function ComparePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <UniversalCompare />
    </Suspense>
  );
}
