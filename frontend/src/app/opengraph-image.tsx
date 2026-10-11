import { brandOgImage, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/render";

export const runtime = "nodejs";
export const alt = "REPBrasil — Inteligência Eleitoral";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return brandOgImage({
    eyebrow: "Dados públicos oficiais",
    title: "Eleições brasileiras, da urna ao candidato.",
    subtitle: "Resultados por seção, zona e município, histórico de candidaturas, patrimônio e contas de campanha.",
    footnote: "Fontes: TSE e IBGE",
  });
}
