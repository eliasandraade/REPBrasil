"use client";

import { Suspense } from "react";
import { ElectionsExplorer } from "@/components/elections/ElectionsExplorer";

/** /eleicoes/:ano/:turno[/:uf[/:municipio[/zona/:n[/secao/:n]]]] — o território vive na URL. */
export default function ElectionsExplorerPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <ElectionsExplorer />
    </Suspense>
  );
}
