import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Políticos e candidatos",
  description: "Políticos e candidatos com candidatura registrada no TSE: histórico eleitoral, votos por território, patrimônio e contas.",
  path: "/politicos",
});

export default function PoliticosLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
