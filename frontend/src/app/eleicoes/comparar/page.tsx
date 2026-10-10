"use client";

import { Suspense } from "react";
import { ComparisonView } from "@/components/elections/ComparisonView";

/** /eleicoes/comparar?c=id1,id2…&uf=CE&nivel=municipality|zone|section|place&municipio=&zona= — até 5 candidaturas. */
export default function ComparePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <ComparisonView />
    </Suspense>
  );
}
