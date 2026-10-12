import type { Metadata } from "next";
import { Suspense } from "react";
import { ElectoralLiveHub } from "@/components/elections/ElectoralLiveHub";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pesquisas & apuração",
  description: "Pesquisas eleitorais registradas e snapshots oficiais de totalização do TSE, com proveniência e estado parcial/final explícitos.",
  path: "/pesquisas",
});

export default function PollsAndLivePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <ElectoralLiveHub />
    </Suspense>
  );
}
