import { brandOgImage, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/render";

export const runtime = "nodejs";
export const alt = "Apuração presidencial 2026 — 2º turno · REPBrasil";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** Cartão social estático e seguro: sem placar (um placar em cache ficaria velho em minutos). */
export default function OpengraphImage() {
  return brandOgImage({
    eyebrow: "Apuração presidencial 2026 · 2º turno",
    title: "Acompanhe a totalização oficial em tempo real.",
    subtitle: "Votos, seções totalizadas, estados, municípios e situação matemática, com os dados oficiais do TSE.",
    footnote: "Fonte: TSE — arquivos oficiais de divulgação de resultados",
  });
}
