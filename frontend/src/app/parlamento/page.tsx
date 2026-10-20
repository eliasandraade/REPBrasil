import type { Metadata } from "next";
import { Suspense } from "react";
import { ParliamentHub } from "@/components/parliament/ParliamentHub";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Atividade parlamentar",
  description: "Atos parlamentares e emendas com fontes oficiais, proveniência e identidade auditável, por UF carregada.",
  path: "/parlamento",
});

export default function ParliamentPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <ParliamentHub />
    </Suspense>
  );
}
