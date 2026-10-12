import type { Metadata } from "next";
import { BrazilWorkspace } from "@/components/home/BrazilWorkspace";
import { pageMetadata } from "@/lib/seo";
export const metadata: Metadata = pageMetadata({
  title: "REPBrasil — explore o Brasil pelos dados",
  absoluteTitle: true,
  description:
    "Explore territórios, eleições e candidaturas a partir de dados públicos oficiais do TSE e malhas do IBGE.",
  path: "/",
});
export default function HomePage() {
  return <BrazilWorkspace />;
}
