import type { Metadata } from "next";
import { DataExplorer } from "@/components/data/DataExplorer";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Dados",
  description: "Indicadores socioeconômicos oficiais por município, correlações exploratórias e agrupamentos com proveniência auditável.",
  path: "/dados",
});

export default function DataPage() {
  return <DataExplorer />;
}
