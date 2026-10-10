import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Eleições",
  description: "Resultados oficiais do TSE por seção eleitoral, do estado à urna, com Boletim de Urna e cadastro eleitoral de origem.",
  path: "/eleicoes",
});

export default function EleicoesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
