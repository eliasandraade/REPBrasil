import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Suporte e correções",
  description: "Peça a correção de um dado com a fonte oficial, tire dúvidas sobre a metodologia e fale com a equipe do REPBrasil.",
  path: "/suporte",
});

export default function SuporteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
