import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

// Cada combinação de candidaturas é uma consulta (parâmetros na URL): só a página base é canônica.
export const metadata: Metadata = pageMetadata({
  title: "Comparar candidaturas",
  description: "Compare até cinco candidaturas lado a lado: ranking, evolução entre eleições e território, com avisos quando a comparação não vale.",
  path: "/eleicoes/comparar",
});

export default function CompararLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
