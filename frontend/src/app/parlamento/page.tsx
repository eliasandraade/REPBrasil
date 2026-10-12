import type { Metadata } from "next";
import { ParliamentHub } from "@/components/parliament/ParliamentHub";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Atividade parlamentar",
  description: "Atos parlamentares e emendas com fontes oficiais, proveniência e identidade auditável para o recorte do Ceará.",
  path: "/parlamento",
});

export default function ParliamentPage() {
  return <ParliamentHub />;
}
